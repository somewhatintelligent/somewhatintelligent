/**
 * The payment provider port.
 *
 * THIS IS THE FILE v2 WAS MISSING. Both of its `NotImplemented` sites —
 * `consumeEventBatch` and `reconcilePendingReservations` — failed by name for
 * the same underlying reason: there was no port to write them against, so every
 * question ("which session states heal, which release?") had to be answered
 * against a concrete SDK or not at all.
 *
 * Four methods is the whole surface the store needs, and none of them mention a
 * vendor. `retrieve` and `expire` are what the reconcile sweep requires;
 * `createSession` is what checkout requires; `parseEvent` is what the webhook
 * requires — it is the only place a provider's wire format is understood, and
 * it is where signature verification lives.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { Destination } from "./StripeConfig.ts";

/** A session's lifecycle state, normalised away from any one provider's vocabulary. */
export type SessionStatus = "open" | "complete" | "expired";

/**
 * Whether money actually moved. Separate from `status`: a session can be
 * complete and unpaid.
 *
 * Defined in `core/` and re-exported here rather than restated, because the
 * settlement policy decides things FROM it and this port describes things WITH
 * it — two copies of a three-member union is exactly the kind of duplication
 * that drifts silently once one side gains a member.
 */
import type { PaymentStatus } from "../core/settlement-policy.ts";
export type { PaymentStatus };

export interface Session {
  readonly id: string;
  readonly status: SessionStatus;
  readonly paymentStatus: PaymentStatus;
  readonly orderId: string | null;
  /**
   * WHAT WAS ACTUALLY CHARGED, broken out.
   *
   * Line items are ours; shipping and tax are the provider's, decided from the
   * rate the buyer picked and the address they typed. All four are zero until a
   * session settles, which is exactly why the order row treats them as unknown
   * until then.
   */
  readonly amountSubtotalCents: number;
  readonly amountShippingCents: number;
  readonly amountTaxCents: number;
  readonly amountTotalCents: number;
  readonly currency: string;
  /** The charge behind a settled session — the join key for refunds. */
  readonly paymentIntentId: string | null;
  readonly expiresAt: number;
  /**
   * Where to send the buyer to pay.
   *
   * Nullable because it is not universal: a provider's hosted page has one, an
   * embedded or terminal flow does not, and a session that has already completed
   * or expired no longer serves one. A storefront that gets `null` has to render
   * its own next step rather than assume a redirect — which is the honest shape,
   * since assuming it means a checkout button that silently goes nowhere.
   */
  readonly checkoutUrl: string | null;
  /** Collected by the hosted checkout DURING payment, so absent until complete. */
  readonly email: string | null;
  readonly shipping: {
    readonly name: string;
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly region: string;
    readonly postal: string;
    readonly phone: string | null;
  } | null;
}

/** The compacted event a webhook enqueues — a snapshot, so settling needs no re-fetch. */
export interface ProviderEvent {
  readonly id: string;
  readonly type: string;
  readonly sessionId: string | null;
  readonly paymentStatus: PaymentStatus | null;
  readonly orderId: string | null;
  /**
   * Whether the event came from the provider's LIVE environment. Checked
   * against the deployment before anything is applied — a test-mode event
   * reaching production would settle a real order against a fake payment.
   */
  readonly livemode: boolean;
  /** Collected by the hosted checkout DURING payment, so absent until settled. */
  readonly email: string | null;
  readonly shipping: Session["shipping"];
  /** Two-letter destination the buyer actually entered. */
  readonly shipCountry: string | null;
  /**
   * The amounts CHARGED, copied onto the order when the event settles it.
   *
   * Null on every event that is not a settlement — an expiry has nothing to
   * report, and defaulting it to zero would let a stale event blank out the real
   * figures on an already-paid order.
   */
  readonly amounts: {
    readonly subtotalCents: number;
    readonly shippingCents: number;
    readonly taxCents: number;
    readonly totalCents: number;
    readonly currency: string;
  } | null;
  readonly paymentIntentId: string | null;
  /**
   * Present only on a REVERSAL, and the distinction it carries is the whole
   * point: providers emit the same event type for a partial refund as for a full
   * one. Without the amounts there is no way to tell a courtesy refund from a
   * cancellation, and the only safe reading — treat every refund as total — is
   * the one that cancels live orders and re-lists goods the customer keeps.
   *
   * `amountRefundedCents` is CUMULATIVE on the charge, so writing it absolutely
   * is naturally idempotent under redelivery.
   */
  readonly refund: {
    readonly amountRefundedCents: number;
    readonly chargeAmountCents: number;
    readonly fullyRefunded: boolean;
  } | null;
}

export class PaymentsUnavailable extends Schema.TaggedErrorClass<PaymentsUnavailable>()(
  "PaymentsUnavailable",
  { operation: Schema.String, message: Schema.String },
) {}

export class EventNotVerified extends Schema.TaggedErrorClass<EventNotVerified>()(
  "EventNotVerified",
  { message: Schema.String },
) {}

export class Payments extends Context.Service<
  Payments,
  {
    /**
     * Minor-unit currency this provider quotes in. Read at order-write time so
     * the row records what it was actually priced in.
     */
    readonly currency: string;
    createSession(input: {
      readonly orderId: string;
      readonly orderNumber: string;
      /**
       * Our line-item total, and NOT what the buyer will be charged — shipping
       * and tax are added by the provider on top. Passed so the provider can
       * decide whether the order clears the free-shipping threshold.
       */
      readonly subtotalCents: number;
      /**
       * Where the cart is going, chosen on the storefront before checkout opens.
       * It fixes both the shipping rate and the countries the address form will
       * accept, so a buyer cannot pay one country's postage to another's.
       */
      readonly destination: Destination;
      readonly expiresAt: number;
      readonly lines: ReadonlyArray<{
        readonly title: string;
        readonly size: string;
        readonly unitPriceCents: number;
        readonly quantity: number;
        /** Sold against a manufacturing run rather than a shelf. */
        readonly preorder: boolean;
      }>;
    }): Effect.Effect<Session, PaymentsUnavailable>;
    retrieve(sessionId: string): Effect.Effect<Session, PaymentsUnavailable>;
    expire(sessionId: string): Effect.Effect<Session, PaymentsUnavailable>;
    /**
     * Verify a webhook's signature and compact it. The ONLY place a provider's
     * wire format is understood — everything downstream sees `ProviderEvent`.
     */
    parseEvent(
      body: string,
      signature: string | null,
    ): Effect.Effect<ProviderEvent, EventNotVerified>;
  }
>()("platform.commerce/services/Payments") {}
