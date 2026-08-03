/**
 * The reconcile sweep — v2's `reconcilePendingReservations`, and the store's
 * actual money backstop.
 *
 * It covers the two reservation failure classes no webhook can:
 *
 *  - ORPHAN: stock decremented, no session ever attached (the provider call
 *    failed after the reservation committed). Resolvable from the database
 *    alone, but only after a GRACE WINDOW — an order mid-checkout is
 *    indistinguishable from an orphan for a few seconds.
 *  - STALE-ATTACHED: a session is attached, its expiry has passed, and no
 *    terminal payment status landed. NOT resolvable from the database: whether
 *    that session can still be paid is a question only the provider can answer.
 *
 * HEAL BEFORE RELEASE. A session the provider reports as complete-and-paid means
 * the buyer WAS charged and the settlement event was lost — that order is
 * advanced to paid and its stock stays held. Only a session PROVEN dead releases
 * stock: already expired, or successfully expired by this sweep. Anything
 * inconclusive — a failed lookup, a complete-but-still-settling session — is
 * left for the next run and never released blind, because releasing paid stock
 * is unrecoverable while waiting one more cycle costs nothing.
 *
 * This is the routine that makes the absence of a dead-letter queue safe: it
 * recovers a captured charge whether or not the event was ever delivered.
 */
import { and, asc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { Database, query, type DbStatement } from "../services/Database.ts";
import { Payments } from "../services/Payments.ts";
import { releaseStatements } from "./Reservations.ts";
import { settledColumns } from "./Settlement.ts";
import { customerOrder, orderItem } from "./Schema.ts";

/** How long an order may hold stock with no session before it is presumed abandoned. */
const ORPHAN_GRACE_MS = 15 * 60_000;

/**
 * How many orders one sweep will touch, per category.
 *
 * UNBOUNDED WAS A LIVENESS BUG, not merely a slow one. Each stale order costs a
 * provider round trip plus its own writes, and the sweep runs inside a cron
 * invocation with a wall-clock budget. A backlog large enough to exhaust that
 * budget gets killed partway — and because the query is ordered the same way
 * every time, the next run starts on the same rows and dies in the same place.
 * The tail is never reached, and nothing reports that it was not.
 *
 * With a bound, each run finishes and makes progress, and `remaining` says
 * whether to expect more. Quarter-hourly at this size drains any realistic
 * backlog within a few runs.
 */
const SWEEP_LIMIT = 100;

interface SweepResult {
  readonly orphansReleased: number;
  readonly healed: number;
  readonly released: number;
  readonly inconclusive: number;
  /**
   * This run hit {@link SWEEP_LIMIT}. A truncated sweep is indistinguishable
   * from a finished one unless it says so, and silently dropping the tail is how
   * held stock stays held.
   */
  readonly remaining: boolean;
}

export const sweep = Effect.fn("Reconcile.sweep")(function* (): Effect.fn.Return<
  SweepResult,
  never,
  Database | Payments
> {
  const database = yield* Database;
  const payments = yield* Payments;
  const db = database.db;
  const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);

  const linesOf = Effect.fn("Reconcile.linesOf")(function* (orderId: string) {
    return yield* query(() =>
      db
        .select({
          variantId: orderItem.variantId,
          productId: orderItem.productId,
          quantity: orderItem.quantity,
          preorder: orderItem.preorder,
        })
        .from(orderItem)
        .where(eq(orderItem.orderId, orderId)),
    );
  });

  const release = Effect.fn("Reconcile.release")(function* (orderId: string) {
    const lines = yield* linesOf(orderId);
    yield* Effect.orDie(
      database.run([
        ...releaseStatements(db, orderId, lines, now),
        db
          .update(customerOrder)
          .set({ status: "cancelled", updatedAt: now })
          .where(eq(customerOrder.id, orderId)) as unknown as DbStatement,
      ]),
    );
  });

  // ── Orphans: stock held, no session, past the grace window ─────────────────
  const orphans = yield* query(() =>
    db
      .select({ id: customerOrder.id })
      .from(customerOrder)
      .where(
        and(
          isNull(customerOrder.sessionId),
          eq(customerOrder.status, "pending"),
          lt(customerOrder.createdAt, now - ORPHAN_GRACE_MS),
        ),
      )
      // Oldest first, so a backlog drains in the order it accumulated rather
      // than starving whatever happens to sort last.
      .orderBy(asc(customerOrder.createdAt))
      .limit(SWEEP_LIMIT),
  );

  let orphansReleased = 0;
  for (const orphan of orphans) {
    yield* release(orphan.id);
    orphansReleased += 1;
  }

  // ── Stale-attached: session expired, no terminal payment status ────────────
  const stale = yield* query(() =>
    db
      .select({ id: customerOrder.id, sessionId: customerOrder.sessionId })
      .from(customerOrder)
      .where(
        and(
          isNotNull(customerOrder.sessionId),
          eq(customerOrder.status, "pending"),
          eq(customerOrder.paymentStatus, "unpaid"),
          lt(customerOrder.sessionExpiresAt, now),
        ),
      )
      // Oldest expiry first: the longest-held stock is released soonest.
      .orderBy(asc(customerOrder.sessionExpiresAt))
      .limit(SWEEP_LIMIT),
  );

  let healed = 0;
  let released = 0;
  let inconclusive = 0;

  for (const order of stale) {
    if (!order.sessionId) continue;

    /**
     * A failed lookup PROVES NOTHING — the payment may have just landed — so it
     * is mapped to `null` and counted as inconclusive rather than treated as
     * evidence the order can be released.
     */
    const session = yield* payments
      .retrieve(order.sessionId)
      .pipe(Effect.catchTag("PaymentsUnavailable", () => Effect.succeed(null)));
    if (session === null) {
      inconclusive += 1;
      continue;
    }

    /** Complete AND settled: the buyer was charged and the event was lost. Heal. */
    if (
      session.status === "complete" &&
      (session.paymentStatus === "paid" || session.paymentStatus === "no_payment_required")
    ) {
      /**
       * THE SAME COLUMNS THE WEBHOOK WOULD HAVE WRITTEN, through the same
       * builder.
       *
       * This branch exists because the event never arrived, so it is the ONLY
       * record this order will get. Writing `status = 'paid'` alone left the
       * amounts at their zero defaults — an order the schema's own rule says to
       * read `totalCents` from, reporting a sale of nothing — with no address to
       * ship to and, worst of all, no payment intent, which is the only join a
       * later refund or dispute has back to it.
       *
       * The session was retrieved BY THIS ORDER'S OWN session id, so unlike the
       * webhook path there is no question of whose session it describes.
       */
      yield* Effect.orDie(
        database.run([
          db
            .update(customerOrder)
            .set({
              status: "paid",
              paymentStatus: "paid",
              ...settledColumns({
                paymentIntentId: session.paymentIntentId,
                shipCountry: session.shipping ? null : null,
                email: session.email,
                amounts: {
                  subtotalCents: session.amountSubtotalCents,
                  shippingCents: session.amountShippingCents,
                  taxCents: session.amountTaxCents,
                  totalCents: session.amountTotalCents,
                  currency: session.currency,
                },
                shipping: session.shipping,
              }),
              updatedAt: now,
            })
            .where(eq(customerOrder.id, order.id)) as unknown as DbStatement,
        ]),
      );
      healed += 1;
      continue;
    }

    /** Complete but still settling — leave it for its event. */
    if (session.status === "complete") {
      inconclusive += 1;
      continue;
    }

    /**
     * Still open: release ONLY once the provider confirms it can no longer be
     * paid. A refused `expire` means the session went complete underneath us,
     * so the order is left alone.
     */
    if (session.status === "open") {
      const expired = yield* payments.expire(session.id).pipe(
        Effect.as(true),
        Effect.catchTag("PaymentsUnavailable", () => Effect.succeed(false)),
      );
      if (!expired) {
        inconclusive += 1;
        continue;
      }
    }

    yield* release(order.id);
    released += 1;
  }

  /**
   * Whether this run hit its bound. A sweep that is silently truncated looks
   * identical to one with nothing left to do, so it says which it was — the
   * cron logs it, and a persistent `true` means the backlog is growing faster
   * than quarter-hourly runs drain it.
   */
  const remaining = orphans.length === SWEEP_LIMIT || stale.length === SWEEP_LIMIT;

  return { orphansReleased, healed, released, inconclusive, remaining };
});
