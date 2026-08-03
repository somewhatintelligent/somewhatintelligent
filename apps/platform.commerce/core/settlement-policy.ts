/**
 * The event-to-outcome policy: which events mean what, and when an event has
 * arrived too late to be applied.
 *
 * Extracted from `Domain/Settlement.ts` unchanged in behaviour. `settle` was 351
 * lines and 49 branches because the decision and the SQL that acts on it were
 * interleaved; lifting the decision out took it to 322 and 36, and put the rules
 * somewhere they can be enumerated exhaustively without a queue, a webhook or a
 * deployment. The four batch arms are what is left, and they are the reason it
 * is still long.
 *
 * Providers redeliver, and they redeliver OUT OF ORDER. Every rule here exists
 * because some ordering of real events would otherwise move money backwards.
 */

export type PaymentStatus = "unpaid" | "paid" | "no_payment_required";

/** Events that move an order toward paid. */
export const SETTLING: ReadonlySet<string> = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

/** Events that end an order without payment. Each must release stock. */
export const FAILING: ReadonlySet<string> = new Set([
  "checkout.session.expired",
  "checkout.session.async_payment_failed",
]);

/**
 * MONEY GOING BACK.
 *
 * These arrive as CHARGE events, which carry no session and no metadata — the
 * payment intent recorded at settlement is the only join back to an order. They
 * are handled separately from `FAILING` because the order was genuinely paid and
 * may already be shipped, so the stock question has a different answer.
 */
export const REVERSING: ReadonlySet<string> = new Set([
  "charge.refunded",
  "charge.dispute.created",
]);

/**
 * Statuses no checkout event may move an order out of.
 *
 * Anything already shipped or delivered is terminal against both classes — the
 * goods have left the building and no payment event changes that.
 */
const TERMINAL: ReadonlySet<string> = new Set(["shipped", "delivered"]);

/** THE PAID PREDICATE, stated once so no call site can disagree. */
export const isPaid = (status: PaymentStatus | null): boolean =>
  status === "paid" || status === "no_payment_required";

export interface EventClass {
  readonly settling: boolean;
  readonly failing: boolean;
  readonly reversing: boolean;
  /** None of the three — nothing this store acts on. */
  readonly ignorable: boolean;
}

export const classifyEvent = (eventType: string): EventClass => {
  const settling = SETTLING.has(eventType);
  const failing = FAILING.has(eventType);
  const reversing = REVERSING.has(eventType);
  return { settling, failing, reversing, ignorable: !settling && !failing && !reversing };
};

/**
 * HAS THIS ORDER ALREADY MOVED PAST THE STATE THIS EVENT DESCRIBES?
 *
 * `cancelled` is terminal against BOTH checkout classes, not just settling. The
 * failing arm was once missing, and its absence was not theoretical: the sweep
 * expires a session and releases the order, the provider then emits
 * `checkout.session.expired` BECAUSE we expired it, that event carries a fresh
 * id so it is not a duplicate, and the failing branch cancelled-and-released an
 * order that was already cancelled and released.
 *
 * `paymentStatus === "paid"` is terminal against settling, so a redelivered
 * `completed` carrying its original unpaid snapshot cannot demote a settled
 * order back to `processing`. An async success arrives while the status is
 * `processing`, so it still passes.
 *
 * A REVERSAL IS NEVER LATE. Money coming back on an order already out the door
 * is precisely the case an operator most needs recorded, so reversals bypass
 * the guard entirely. They are safe to re-apply because the release is
 * idempotent and the refunded total is written absolutely.
 */
export const isLateEvent = (input: {
  readonly eventClass: EventClass;
  readonly orderStatus: string;
  readonly orderPaymentStatus: string;
}): boolean => {
  const { settling, failing, reversing } = input.eventClass;
  if (reversing) return false;
  return (
    TERMINAL.has(input.orderStatus) ||
    ((settling || failing) && input.orderStatus === "cancelled") ||
    (failing && input.orderStatus === "paid") ||
    (settling && input.orderPaymentStatus === "paid")
  );
};

/**
 * Does this event describe the session checkout attached to this order?
 *
 * It is not the same question as "does it name our order". An event reaches
 * settlement either because its session id matched, or because its metadata
 * carried our order id — and the second path admits a session we never created:
 * a re-fired fixture, a manually replayed event, a session minted against the
 * same order id by something else.
 *
 * Everything the buyer supplied DURING payment — the address, the amounts, the
 * receipt email, the charge — describes that session and not necessarily this
 * order. Copying a foreign session's address onto a paid order would ship
 * someone else's parcel to their door.
 *
 * A null `orderSessionId` is the orphan case the metadata fallback exists to
 * repair, so it admits the collected facts.
 */
export const describesOurSession = (
  orderSessionId: string | null,
  eventSessionId: string | null,
): boolean =>
  orderSessionId === null || (eventSessionId !== null && eventSessionId === orderSessionId);

/** Which `paymentStatus` a failing event leaves behind. */
export const failedPaymentStatus = (eventType: string): "expired" | "failed" =>
  eventType.endsWith("expired") ? "expired" : "failed";
