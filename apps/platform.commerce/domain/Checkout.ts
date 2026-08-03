/**
 * Order capture — the consumer that makes the reservation core reachable.
 *
 * In v2 `reserveStockAndWrite` is dead code: correct, hard-won, and called by
 * nothing, because checkout was never ported. This module closes that loop, and
 * it is the first place the `Payments` port earns its keep.
 *
 * ORDER OF OPERATIONS MATTERS. Stock is reserved and the order row written in
 * ONE batch, and only then is a payment session created. Creating the session
 * first would leave a live session pointing at stock nobody holds; reserving
 * first means the worst case is an ORPHAN — stock held with no session attached
 * — which is exactly the state the reconcile sweep is built to find and release.
 */
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { CoreOutcome } from "../services/Audit.ts";
import { Database, type ClassicDb, type DbStatement } from "../services/Database.ts";
import { Ids } from "../services/Ids.ts";
import { Payments } from "../services/Payments.ts";
import type { Destination } from "../services/StripeConfig.ts";
import { err, ok } from "./Contracts.ts";
import {
  classifyGuards,
  guardWon,
  compensateStatement,
  compensateRunStatement,
  computeTotals,
  guardStatement,
  loadPricingInputs,
  orderRollbackStatements,
  runClaims,
  runGuardStatement,
  type CartItem,
  type OrderLine,
} from "./Reservations.ts";
import { customerOrder, orderItem } from "./Schema.ts";

/**
 * How long a fresh payment session may hold stock.
 *
 * THIRTY-FIVE minutes, not thirty, and the five is not arbitrary. Stripe refuses
 * a session whose `expires_at` is under 30 minutes away, and the deadline is
 * computed here but evaluated there — so network latency and the floor to whole
 * seconds both eat into it. Exactly 30 would fail intermittently, under load,
 * on the checkout path, which is the worst possible place for a flake.
 */
const SESSION_TTL_MS = 35 * 60_000;

export interface PlaceOrderInput {
  readonly items: readonly CartItem[];
  readonly email: string;
  readonly customerId: string;
  /**
   * Where the cart is going, chosen on the storefront before checkout opens.
   *
   * Required rather than inferred, because it decides the shipping rate and the
   * countries the address form will accept — and inferring it from an address we
   * do not have yet is the mistake that lets someone pay Canadian postage to
   * Texas.
   */
  readonly destination: Destination;
}

interface PlacedOrder {
  readonly orderNumber: string;
  /**
   * LINE ITEMS ONLY. Shipping and tax are added by the provider on the payment
   * page, so this is not what the buyer will be charged — and calling it
   * `totalCents` would invite a storefront to display it as one.
   */
  readonly subtotalCents: number;
  readonly sessionId: string;
  /** Where the buyer goes to pay. `null` under a provider with no hosted page. */
  readonly checkoutUrl: string | null;
}

type CheckoutError =
  | "empty_cart"
  | "invalid_quantity"
  | "variant_not_found"
  | "product_unavailable"
  | "out_of_stock"
  /** A pre-order run is fully subscribed — distinct from a shelf being empty. */
  | "preorder_full"
  /**
   * Another request with the same command id is mid-flight, or died mid-flight.
   * A double tap gets this on the losing request while the winner completes —
   * which is the correct answer: one cart, one reservation.
   */
  | "in_progress"
  | "payments_unavailable";

/**
 * The order number a customer quotes. Derived from the id's tail rather than a
 * counter, so it needs no sequence table and no coordination.
 */
const orderNumberFor = (orderId: string): string => `SO-${orderId.slice(-8).toUpperCase()}`;

const orderWriteStatements = (
  db: ClassicDb,
  orderId: string,
  orderNumber: string,
  input: PlaceOrderInput,
  lines: readonly OrderLine[],
  subtotalCents: number,
  currency: string,
  now: number,
  itemIds: readonly string[],
): readonly DbStatement[] => [
  db.insert(customerOrder).values({
    id: orderId,
    orderNumber,
    userId: input.customerId,
    email: input.email,
    status: "pending",
    paymentStatus: "unpaid",
    subtotalCents,
    currency,
    /**
     * Shipping, tax and total are deliberately LEFT AT ZERO here. They are not
     * yet knowable — the buyer has not chosen a rate or entered an address — and
     * writing a guess would put a number in the books that no receipt agrees
     * with. The settlement path fills all three from the paid event.
     */
    shipCountry: input.destination,
    /**
     * BORN RELEASED, and cleared only once the reservation is known good.
     *
     * `releaseStatements` guards every restore on this marker being null, so
     * setting it here means the sweep can restore NOTHING for this order until
     * classification clears it. That closes the window this batch opens: the
     * guards and the order rows commit TOGETHER, including a line whose guard
     * matched nothing, so a process that dies before compensation runs would
     * otherwise leave the orphan sweep restoring stock for every `order_item`
     * row — including lines that never decremented.
     *
     * The failure mode that fixes is the expensive direction. Restoring a line
     * that never reserved INVENTS inventory: units that do not physically exist,
     * sold to a buyer who can never be shipped. Leaving a winner's decrement
     * stranded instead understates stock, which an operator can see and correct
     * with `adjustStock`. Understating is recoverable; overstating is not.
     */
    stockReleasedAt: now,
    createdAt: now,
    updatedAt: now,
  }) as unknown as DbStatement,
  ...lines.map(
    (line, index) =>
      db.insert(orderItem).values({
        id: itemIds[index] as string,
        orderId,
        productId: line.productId,
        variantId: line.variantId,
        // SNAPSHOT: later catalog edits never rewrite this line.
        titleSnapshot: line.title,
        sizeSnapshot: line.size,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
        preorder: line.preorder,
        expectedShipAt: line.expectedShipAt,
      }) as unknown as DbStatement,
  ),
];

/**
 * Price the cart, reserve stock and write the order atomically, compensate if a
 * guard lost, then attach a payment session.
 *
 * Returns a {@link CoreOutcome} so `Audit.command` commits it — which is what
 * makes a retried checkout idempotent rather than a second reservation.
 */
export const placeOrder = Effect.fn("Checkout.placeOrder")(function* (
  input: PlaceOrderInput,
  /**
   * THE LEDGER'S CLAIM, and it goes in the FIRST batch — beside the stock
   * guards, not after them.
   *
   * This core cannot hand its statements to `Audit.command`: it has to commit
   * the reservation, inspect which guards won, and only then call the payment
   * provider. That left the reservation outside the ledger's batch, so two taps
   * of Buy both missed the replay check, both decremented stock, and the loser
   * died on the unique index with its phantom hold intact.
   *
   * Committing the claim WITH the guards makes the unique index arbitrate the
   * reservation itself: both requests reach the batch, exactly one commits, and
   * the loser's guards roll back with it.
   */
  claim: DbStatement,
): Effect.fn.Return<CoreOutcome<PlacedOrder, CheckoutError>, never, Database | Ids | Payments> {
  const database = yield* Database;
  const ids = yield* Ids;
  const payments = yield* Payments;
  const db = database.db;

  /**
   * The currency the order is QUOTED in, recorded on the row rather than left to
   * the column default. The default is right only by coincidence today, and the
   * column exists precisely so the constant can stop being constant.
   */
  const currency = payments.currency;

  const { variants, products } = yield* loadPricingInputs(
    db,
    input.items.map((item) => item.variantId),
  );
  const totals = computeTotals(input.items, variants, products);
  if (!totals.ok) {
    return { failure: err(totals.error as CheckoutError, totals.message) };
  }

  const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
  const orderId = yield* ids.next();
  const itemIds = yield* ids.many(totals.lines.length);
  const orderNumber = orderNumberFor(orderId);

  /**
   * The guards and the order writes commit together. If any guard matched no
   * row the batch still SUCCEEDS — a zero-row UPDATE is not an error — so the
   * result has to be inspected rather than trusted.
   */
  /**
   * Two levels of guard, both compare-and-set, both in the SAME batch as the
   * order writes: one per variant against its own count, and one per product
   * against its manufacturing run. A pre-order for two sizes of one shirt takes
   * two variant guards and ONE run guard, which is the whole reason the run cap
   * lives on the product.
   *
   * Order matters — `classifyGuards` reads the results positionally, because
   * positional correspondence is all D1's batch hands back.
   */
  const claims = runClaims(totals.lines);

  /**
   * THE CLAIM IS A GUARD LIKE ANY OTHER, and it is read the same way.
   *
   * The claim shares this batch with the stock guards precisely so a concurrent
   * duplicate loses to the unique index rather than reserving twice. That is a
   * CONTROL PATH, not a crash — so it must not arrive as an exception. An
   * `ON CONFLICT DO NOTHING` claim reports its loss the way every other
   * conditional write here does: `meta.changes === 0`.
   *
   * This replaces a regex over D1's error text
   * (`/UNIQUE constraint failed: command_event/`). Matching a driver's prose to
   * decide control flow means a wording change in drizzle or D1 turns the losing
   * tap of a double-clicked Buy into a 500 — on the money path, silently, at the
   * next dependency bump.
   *
   * The trade is real and worth naming: a constraint violation used to abort the
   * batch and roll everything back, so there was nothing to compensate. `DO
   * NOTHING` lets the batch commit, so the loser now unwinds explicitly — using
   * the same compensation the lost-stock-guard path already runs, and covered by
   * the same release marker.
   */
  const results = yield* Effect.orDie(
    database.run([
      claim,
      ...totals.lines.map((line) => guardStatement(db, line)),
      ...claims.map((claim) => runGuardStatement(db, claim)),
      ...orderWriteStatements(
        db,
        orderId,
        orderNumber,
        input,
        totals.lines,
        totals.subtotalCents,
        currency,
        now,
        itemIds,
      ),
    ]),
  );

  /**
   * The claim occupies the FIRST slot. Losing it means another request with this
   * command id already holds the ledger row, so this one reserved nothing it may
   * keep — hand back every guard that won and delete the order rows that
   * committed beside them.
   */
  if (!guardWon(results[0])) {
    const all = classifyGuards(totals.lines, claims, results.slice(1));
    yield* Effect.orDie(
      database.run([
        ...all.succeeded.map((line) => compensateStatement(db, line)),
        ...all.claimed.map((claim) => compensateRunStatement(db, claim)),
        ...orderRollbackStatements(db, orderId),
      ]),
    );
    return { failure: err("in_progress") };
  }

  /**
   * The claim occupies the FIRST slot, so the guard results start one later.
   * `classifyGuards` reads positionally because positional correspondence is all
   * D1's batch hands back, which makes this offset load-bearing rather than
   * cosmetic.
   */
  const { succeeded, firstFailing, claimed, firstFullRun } = classifyGuards(
    totals.lines,
    claims,
    results.slice(1),
  );

  /**
   * ANY guard losing unwinds ALL of them. A zero-row UPDATE does not abort a D1
   * batch, so the winners committed alongside the loser and have to be handed
   * back explicitly — variant counts and run places alike.
   */
  if (firstFailing || firstFullRun) {
    yield* Effect.orDie(
      database.run([
        ...succeeded.map((line) => compensateStatement(db, line)),
        ...claimed.map((claim) => compensateRunStatement(db, claim)),
        ...orderRollbackStatements(db, orderId),
      ]),
    );
    /**
     * The run being full is reported as its own condition. Telling a shopper a
     * pre-order is "out of stock" describes inventory that never existed and
     * implies more is coming; `preorder_full` says the run is spoken for.
     */
    return firstFullRun
      ? { failure: err("preorder_full", firstFullRun.title) }
      : {
          failure: err(
            "out_of_stock",
            `${(firstFailing as OrderLine).title} (${(firstFailing as OrderLine).size})`,
          ),
        };
  }

  /**
   * EVERY GUARD WON, so this order's lines really do hold the stock their rows
   * claim — hand it over to the sweep by clearing the release marker.
   *
   * Until this commits the order is BORN RELEASED (see `orderWriteStatements`)
   * and the sweep can restore nothing for it. That covers the one window that
   * matters: batch 1 commits the guards AND the order rows together, including
   * a line whose guard matched nothing, so a process that dies before
   * compensation runs would otherwise leave the sweep restoring stock for lines
   * that never decremented — inventing inventory that does not exist.
   *
   * Cleared HERE rather than alongside the session, because the orphan the
   * `payments_unavailable` path leaves behind is a legitimate reservation the
   * sweep is supposed to release. Deferring the clear until after the provider
   * call would strand that stock instead.
   *
   * The compensation branch above never reaches this: it deletes the order rows
   * outright, so there is nothing left to release.
   */
  yield* Effect.orDie(
    database.run([
      db
        .update(customerOrder)
        .set({ stockReleasedAt: null })
        .where(eq(customerOrder.id, orderId)) as unknown as DbStatement,
    ]),
  );

  /**
   * Stock is held; attach a session. A failure here leaves an ORPHAN on
   * purpose — the sweep releases it after a grace window, which is strictly
   * safer than unwinding a reservation whose session may have just been created
   * on the provider's side.
   */
  const attached = yield* payments
    .createSession({
      orderId,
      orderNumber,
      subtotalCents: totals.subtotalCents,
      destination: input.destination,
      expiresAt: now + SESSION_TTL_MS,
      lines: totals.lines.map((line) => ({
        title: line.title,
        size: line.size,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
        preorder: line.preorder,
      })),
    })
    .pipe(
      /**
       * The provider's failure is a DOMAIN condition here, not a defect: a
       * storefront should render "payments are down, your stock is held" rather
       * than a stack trace. Caught by tag so a new error on this channel has to
       * be handled deliberately instead of being swallowed by a catch-all.
       */
      Effect.catchTag("PaymentsUnavailable", (error) =>
        Effect.succeed({ failure: err("payments_unavailable", error.message) } as const),
      ),
    );
  if ("failure" in attached) return attached;
  const session = attached;

  return {
    statements: [
      db
        .update(customerOrder)
        .set({
          sessionId: session.id,
          // Written in the SAME commit as the session id. An order missing this
          // copy is invisible to the sweep, so the two must never diverge.
          sessionExpiresAt: session.expiresAt,
          updatedAt: now,
        })
        .where(eq(customerOrder.id, orderId)) as unknown as DbStatement,
    ],
    response: ok({
      orderNumber,
      subtotalCents: totals.subtotalCents,
      sessionId: session.id,
      checkoutUrl: session.checkoutUrl,
    }),
    facts: {
      targetType: "order",
      targetId: orderNumber,
      detail: {
        lines: totals.lines.length,
        subtotalCents: totals.subtotalCents,
        destination: input.destination,
        preorder: totals.lines.some((line) => line.preorder),
      },
    },
  };
});
