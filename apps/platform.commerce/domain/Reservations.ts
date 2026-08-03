/**
 * The SQL of pricing and stock reservation. THE RULES LIVE IN `core/`:
 * `core/pricing.ts` decides what a cart costs and `core/guards.ts` decides
 * whether a conditional write took. What is left here is the statements that
 * act on those decisions, plus the queries that load their inputs — which is
 * why this module needs a database handle and those two do not.
 *
 * PRICE AUTHORITY. A price crosses into an order only from the product's ACTIVE
 * RELEASE — never from the draft and never from the client. That rule is
 * enforced by `loadPricingInputs` below: it INNER JOINs through the active
 * release, so a product without one contributes no pricing row and the cart
 * fails closed as `product_unavailable`. Once written, an order line's
 * `unitPriceCents` is a permanent snapshot.
 *
 * RESERVATION CONCURRENCY. Reserving stock is a SQL-guarded conditional UPDATE
 * whose `meta.changes` (0 or 1) is the only trustworthy signal that a line
 * actually reserved. A `Math.max(0, stock - qty)` computed in JS off a stale
 * SELECT lets two concurrent requests both win the last unit.
 *
 * D1's batch aborts on a statement ERROR but NOT on a zero-row UPDATE — a guard
 * matching nothing is a no-op, not a failure. So a failed guard is compensated
 * EXPLICITLY by `Checkout.placeOrder`: re-increment the lines that did
 * decrement and remove the order rows that committed beside them. Measured
 * rather than assumed — test L, `a double-clicked Buy reserves stock once`.
 *
 * Reservation is NOT idempotent. Each call decrements; callers own not invoking
 * it twice for the same intent, which is what `Audit.claimed` guarantees by
 * putting the ledger claim in the same batch as the guards.
 */
import { eq, inArray, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { query, type ClassicDb, type DbStatement } from "../services/Database.ts";
import { customerOrder, orderItem, product, productRelease, productVariant } from "./Schema.ts";

/**
 * Pricing rules and the guard classifier now live in `core/` — both are pure,
 * and both had docstrings claiming they were testable without infrastructure.
 * Re-exported so every existing call site is unchanged.
 */
import { runClaims, type OrderLine, type RunClaim } from "../core/pricing.ts";
import type { PricingProduct, PricingVariant } from "../core/pricing.ts";

export {
  computeTotals,
  runClaims,
  type CartItem,
  type OrderLine,
  type RunClaim,
} from "../core/pricing.ts";
export { classifyGuards, guardWon } from "../core/guards.ts";

/**
 * Load the authoritative pricing inputs: live size and stock from the variant
 * rows, and each product's title and price from its ACTIVE RELEASE. The draft
 * copy and price are never read.
 */
export const loadPricingInputs = Effect.fn("Reservations.loadPricingInputs")(function* (
  db: ClassicDb,
  variantIds: readonly string[],
) {
  if (variantIds.length === 0) {
    return { variants: [] as PricingVariant[], products: [] as PricingProduct[] };
  }

  const variants = yield* query(() =>
    db
      .select({
        id: productVariant.id,
        productId: productVariant.productId,
        size: productVariant.size,
        stock: productVariant.stock,
        mode: productVariant.mode,
        expectedShipAt: productVariant.expectedShipAt,
      })
      .from(productVariant)
      .where(inArray(productVariant.id, [...variantIds])),
  );

  const productIds = [...new Set(variants.map((variant) => variant.productId))];
  if (productIds.length === 0) return { variants, products: [] as PricingProduct[] };

  const products = yield* query(() =>
    db
      .select({
        id: product.id,
        title: productRelease.title,
        priceCents: productRelease.priceCents,
        status: product.status,
        preorderCap: product.preorderCap,
        preorderClaimed: product.preorderClaimed,
      })
      .from(product)
      // INNER join through the active release: a product without one yields no
      // pricing row at all, so the cart fails closed.
      .innerJoin(productRelease, eq(productRelease.id, product.activeReleaseId))
      .where(inArray(product.id, productIds)),
  );

  return { variants, products };
});

/** The guarded decrement for one line. */
export const guardStatement = (db: ClassicDb, line: OrderLine): DbStatement =>
  db
    .update(productVariant)
    .set({ stock: sql`${productVariant.stock} - ${line.quantity}` })
    .where(
      sql`${productVariant.id} = ${line.variantId} and ${productVariant.stock} >= ${line.quantity}`,
    ) as unknown as DbStatement;

/**
 * The guarded claim against a product's RUN.
 *
 * Identical compare-and-set to the variant guard, one level up: it matches no
 * row when the run is full, and a zero-row UPDATE does not abort the batch — so
 * the result is inspected, never trusted. A product with a `null` cap is not
 * sold as a pre-order and the guard matches nothing, which is why a line can
 * only be marked `preorder` if its variant says so.
 */
export const runGuardStatement = (db: ClassicDb, claim: RunClaim): DbStatement =>
  db
    .update(product)
    .set({ preorderClaimed: sql`${product.preorderClaimed} + ${claim.quantity}` })
    .where(
      sql`${product.id} = ${claim.productId} and ${product.preorderCap} is not null and ${product.preorderClaimed} + ${claim.quantity} <= ${product.preorderCap}`,
    ) as unknown as DbStatement;

/** Undo a decrement that committed beside a guard which matched nothing. */
export const compensateStatement = (db: ClassicDb, line: OrderLine): DbStatement =>
  db
    .update(productVariant)
    .set({ stock: sql`${productVariant.stock} + ${line.quantity}` })
    .where(eq(productVariant.id, line.variantId)) as unknown as DbStatement;

/** Undo a run claim that committed beside a guard which matched nothing. */
export const compensateRunStatement = (db: ClassicDb, claim: RunClaim): DbStatement =>
  db
    .update(product)
    .set({ preorderClaimed: sql`max(0, ${product.preorderClaimed} - ${claim.quantity})` })
    .where(eq(product.id, claim.productId)) as unknown as DbStatement;

/** Remove the order rows that committed alongside a failed reservation. */
export const orderRollbackStatements = (db: ClassicDb, orderId: string): readonly DbStatement[] => [
  db.delete(orderItem).where(eq(orderItem.orderId, orderId)) as unknown as DbStatement,
  db.delete(customerOrder).where(eq(customerOrder.id, orderId)) as unknown as DbStatement,
];

/**
 * Restore stock for every line of an order — the reconcile sweep's release path.
 *
 * A RELATIVE increment, never a value computed in JS off a stale read: the sweep
 * runs concurrently with live checkouts, so `stock = <number>` would clobber
 * whatever happened in between.
 */
export interface RestorableLine {
  readonly variantId: string;
  readonly productId: string;
  readonly quantity: number;
  /** Snapshot from the order line, NOT the variant's current mode. */
  readonly preorder: boolean;
}

/**
 * Release an order's stock AT MOST ONCE, whoever asks and however often.
 *
 * THE PROBLEM THIS SOLVES is not a race — it is the sweep's own designed path.
 * `Reconcile.sweep` calls `payments.expire(session)` and then releases; expiring
 * the session makes the provider emit `checkout.session.expired`, which arrives
 * with a FRESH event id, so the `payment_event` replay key does not catch it and
 * the failing branch releases the same units a second time. A refund on an
 * already-released order is a third caller. None of them can see each other.
 *
 * So the fact "this order has been released" is written down. Every restore is
 * guarded on the marker still being null via a correlated subquery, and the
 * marker is claimed in the SAME batch — which is one transaction executed in
 * order, so the guards see the pre-claim null and the claim shuts the door on
 * every future caller. A second release is a batch of zero-row updates.
 *
 * This is the same shape as `guardStatement`: push the predicate into SQL rather
 * than deciding in JS from a read that is stale by the time it is used.
 */
export const releaseStatements = (
  db: ClassicDb,
  orderId: string,
  lines: readonly RestorableLine[],
  now: number,
): readonly DbStatement[] => {
  const unreleased = sql`(select ${customerOrder.stockReleasedAt} from ${customerOrder} where ${customerOrder.id} = ${orderId}) is null`;

  return [
    ...lines.map(
      (line) =>
        db
          .update(productVariant)
          .set({ stock: sql`${productVariant.stock} + ${line.quantity}` })
          .where(
            sql`${productVariant.id} = ${line.variantId} and ${unreleased}`,
          ) as unknown as DbStatement,
    ),
    ...runClaims(
      lines.map((line) => ({
        variantId: line.variantId,
        productId: line.productId,
        title: "",
        size: "",
        unitPriceCents: 0,
        quantity: line.quantity,
        preorder: line.preorder,
        expectedShipAt: null,
      })),
    ).map(
      (claim) =>
        db
          .update(product)
          .set({
            preorderClaimed: sql`max(0, ${product.preorderClaimed} - ${claim.quantity})`,
          })
          .where(
            sql`${product.id} = ${claim.productId} and ${unreleased}`,
          ) as unknown as DbStatement,
    ),
    // Claimed LAST, so every guard above still saw null.
    db
      .update(customerOrder)
      .set({ stockReleasedAt: now })
      .where(
        sql`${customerOrder.id} = ${orderId} and ${customerOrder.stockReleasedAt} is null`,
      ) as unknown as DbStatement,
  ];
};
