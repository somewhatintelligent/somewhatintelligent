/**
 * The Stripe adapter — the only file in the tree that knows Stripe exists.
 *
 * Everything downstream sees `Session` and `ProviderEvent`, which is what lets
 * the domain be tested against a fake and deployed against the real thing
 * without a line changing. Swapping providers means writing a sibling to this
 * file and nothing else.
 *
 * TWO THINGS ARE LOAD-BEARING HERE:
 *
 *  - SIGNATURE VERIFICATION lives in `parseEvent` and nowhere else. It uses
 *    `constructEventAsync` with the WebCrypto provider because Workers have no
 *    synchronous crypto, and a `constructEvent` (sync) call would throw at
 *    runtime rather than fail to compile.
 *  - THE VOCABULARY MAPPING is explicit. Stripe's `status` and `payment_status`
 *    are separate axes and the store's `SessionStatus`/`PaymentStatus` mirror
 *    that split deliberately: a session can be `complete` and still `unpaid`
 *    while an async method settles, and collapsing the two is how a store ships
 *    an order that was never paid for.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import Stripe from "stripe";

import {
  EventNotVerified,
  Payments,
  PaymentsUnavailable,
  type PaymentStatus,
  type ProviderEvent,
  type Session,
  type SessionStatus,
} from "./Payments.ts";
import { MARKETS, type MarketCode } from "../core/markets.ts";
import { StripeConfig } from "./StripeConfig.ts";

/** The store's own id, carried on the session so an event can find its order. */
const ORDER_ID_KEY = "storeOrderId";

const toSessionStatus = (status: string | null): SessionStatus => {
  if (status === "complete") return "complete";
  if (status === "expired") return "expired";
  return "open";
};

const toPaymentStatus = (status: string | null | undefined): PaymentStatus => {
  if (status === "paid") return "paid";
  if (status === "no_payment_required") return "no_payment_required";
  return "unpaid";
};

const toShipping = (session: Stripe.Checkout.Session): Session["shipping"] => {
  const details = session.collected_information?.shipping_details ?? null;
  const address = details?.address;
  if (!details?.name || !address?.line1 || !address.city) return null;
  return {
    name: details.name,
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city,
    region: address.state ?? "",
    postal: address.postal_code ?? "",
    phone: null,
  };
};

const paymentIntentOf = (session: Partial<Stripe.Checkout.Session>): string | null =>
  typeof session.payment_intent === "string"
    ? session.payment_intent
    : (session.payment_intent?.id ?? null);

/**
 * The tax Stripe computed and charged.
 *
 * `total_details.amount_tax` is the number that appears on the buyer's receipt,
 * which makes it the only defensible figure to record — anything re-derived here
 * would be a second opinion about money that has already moved.
 */
const taxOf = (session: Partial<Stripe.Checkout.Session>): number =>
  session.total_details?.amount_tax ?? 0;

const shippingOf = (session: Partial<Stripe.Checkout.Session>): number =>
  session.total_details?.amount_shipping ?? 0;

const toSession = (session: Stripe.Checkout.Session): Session => ({
  id: session.id,
  status: toSessionStatus(session.status),
  paymentStatus: toPaymentStatus(session.payment_status),
  orderId: session.metadata?.[ORDER_ID_KEY] ?? null,
  amountSubtotalCents: session.amount_subtotal ?? 0,
  amountShippingCents: shippingOf(session),
  amountTaxCents: taxOf(session),
  amountTotalCents: session.amount_total ?? 0,
  currency: session.currency ?? "",
  paymentIntentId: paymentIntentOf(session),
  // Stripe reports seconds; every timestamp in this store is milliseconds.
  expiresAt: (session.expires_at ?? 0) * 1000,
  // Present while the session is open; Stripe drops it once it settles.
  checkoutUrl: session.url ?? null,
  email: session.customer_details?.email ?? null,
  shipping: toShipping(session),
});

export const layer = Layer.effect(
  Payments,
  Effect.gen(function* () {
    const config = yield* StripeConfig;

    const stripe = new Stripe(Redacted.value(config.secretKey), {
      // Workers have no Node http stack; this is the supported transport.
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: "2026-07-29.dahlia",
    });

    const unavailable = (operation: string) => (cause: unknown) =>
      new PaymentsUnavailable({
        operation,
        message: cause instanceof Error ? cause.message : String(cause),
      });

    const createSession = Effect.fn("PaymentsStripe.createSession")(function* (input: {
      readonly orderId: string;
      readonly orderNumber: string;
      readonly subtotalCents: number;
      readonly email: string;
      readonly market: MarketCode;
      readonly expiresAt: number;
      readonly lines: ReadonlyArray<{
        readonly title: string;
        readonly size: string;
        readonly unitPriceCents: number;
        readonly quantity: number;
        readonly preorder: boolean;
      }>;
    }) {
      /**
       * THE MARKET DECIDES THE MONEY. Currency comes off the constant, never
       * off a config variable — the line items were priced from this market's
       * release rows, so quoting them in anything else would charge a number
       * nobody ever set.
       */
      const { currency, shipTo } = MARKETS[input.market];

      const session = yield* Effect.tryPromise({
        try: () =>
          stripe.checkout.sessions.create({
            mode: "payment",
            /**
             * Line items are built from OUR prices, never a Stripe Price object.
             * The active release is the price authority; mirroring it into
             * Stripe's catalogue would create a second thing that can disagree.
             */
            line_items: input.lines.map((line) => ({
              quantity: line.quantity,
              price_data: {
                currency,
                unit_amount: line.unitPriceCents,
                /**
                 * EXCLUSIVE: our price is pre-tax and Stripe adds tax on top.
                 * The alternative — declaring prices tax-inclusive — would mean
                 * the same garment nets us different revenue in different
                 * provinces, which is a pricing decision disguised as a flag.
                 */
                tax_behavior: "exclusive",
                product_data: {
                  name: `${line.title} (${line.size})`,
                  // Named so the buyer sees on the payment page — and on their
                  // receipt — that this ships later. Discovering that after
                  // paying is the single most common pre-order complaint.
                  ...(line.preorder
                    ? { description: "Pre-order — ships when the run is made" }
                    : {}),
                  tax_code: config.goodsTaxCode,
                },
              },
            })),

            // Charges only where the account holds a registration — zero
            // everywhere until then, and crossing the $30k threshold is a
            // dashboard registration rather than a deploy.
            automatic_tax: { enabled: true },
            /**
             * NO `shipping_options`, deliberately. The price contains shipping,
             * so there is nothing to charge, nothing to discount, and no line
             * item to pass — `total_details.amount_shipping` comes back absent
             * and settlement's `shippingOf` reads it as zero.
             * `shipping_address_collection` below is an independent parameter,
             * so the address is still collected.
             */
            // The store's own id, so a webhook can find the order without a
            // lookup table.
            // The store's own ids, plus the market for reconciliation. A
            // MIRROR for reading in the dashboard, never a source.
            metadata: {
              [ORDER_ID_KEY]: input.orderId,
              orderNumber: input.orderNumber,
              market: input.market,
            },
            /**
             * REQUIRED. A hosted checkout will not open without somewhere to
             * return the buyer to, and Stripe rejects the create call outright.
             *
             * `{CHECKOUT_SESSION_ID}` is Stripe's own placeholder, substituted on
             * redirect — the storefront needs it to tell "you just paid" from
             * "you reloaded the confirmation page", and it is the only handle it
             * has before the webhook lands.
             */
            success_url:
              `${config.storefrontUrl}/orders/${input.orderNumber}` +
              `?session_id={CHECKOUT_SESSION_ID}`,
            // Back to the cart with the order still reserved — the sweep
            // releases it if they never come back.
            cancel_url: `${config.storefrontUrl}/cart?order=${input.orderNumber}`,
            expires_at: Math.floor(input.expiresAt / 1000),
            /**
             * THE ADDRESS THE ORDER IS FILED UNDER, carried onto the page the
             * buyer actually sees. Stripe prefills it and — because it was
             * supplied rather than collected — will not let it be edited here,
             * which is the property that matters: the order row, the receipt
             * and `session.customer_details.email` are then the same string by
             * construction instead of by coincidence.
             *
             * The storefront has always collected this; it simply stopped at
             * the order row, so the hosted page opened with an empty field and
             * asked for it again.
             */
            customer_email: input.email,
            /**
             * Pinned to the market the cart was priced for. The buyer picked
             * it on the storefront; letting the address form accept another
             * market's country here would ship a cart somewhere it was never
             * priced for.
             */
            shipping_address_collection: { allowed_countries: [...shipTo] },
            billing_address_collection: "required",
          }),
        catch: unavailable("createSession"),
      });
      return toSession(session);
    });

    const retrieve = Effect.fn("PaymentsStripe.retrieve")(function* (sessionId: string) {
      const session = yield* Effect.tryPromise({
        try: () => stripe.checkout.sessions.retrieve(sessionId),
        catch: unavailable("retrieve"),
      });
      return toSession(session);
    });

    /**
     * Expiring is only legal while a session is open — Stripe refuses a
     * completed one, and that refusal is the safety property the reconcile
     * sweep depends on: it releases stock only after `expire` SUCCEEDS.
     */
    const expire = Effect.fn("PaymentsStripe.expire")(function* (sessionId: string) {
      const session = yield* Effect.tryPromise({
        try: () => stripe.checkout.sessions.expire(sessionId),
        catch: unavailable("expire"),
      });
      return toSession(session);
    });

    const parseEvent = Effect.fn("PaymentsStripe.parseEvent")(function* (
      body: string,
      signature: string | null,
    ) {
      if (!signature) {
        return yield* new EventNotVerified({ message: "missing stripe-signature header" });
      }

      /**
       * `constructEventAsync` + the SubtleCrypto provider: Workers have no
       * synchronous crypto, so the sync `constructEvent` would throw at runtime.
       */
      const event = yield* Effect.tryPromise({
        try: () =>
          stripe.webhooks.constructEventAsync(
            body,
            signature,
            Redacted.value(config.webhookSecret),
            undefined,
            Stripe.createSubtleCryptoProvider(),
          ),
        catch: (cause) =>
          new EventNotVerified({
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      /**
       * TWO OBJECT SHAPES REACH THIS FUNCTION.
       *
       * Checkout events carry a Session; refund and dispute events carry a
       * Charge, which knows nothing about the session that created it. The one
       * handle they share is the payment intent, which is why settlement records
       * it — it is the only join from "money went back" to "which order".
       */
      const isCharge = event.type.startsWith("charge.");
      if (isCharge) {
        const charge = event.data.object as Partial<Stripe.Charge> & Partial<Stripe.Dispute>;
        const intent =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : (charge.payment_intent?.id ?? null);
        return {
          id: event.id,
          type: event.type,
          sessionId: null,
          paymentStatus: null,
          orderId: null,
          livemode: event.livemode,
          email: null,
          shipping: null,
          shipCountry: null,
          amounts: null,
          paymentIntentId: intent,
          /**
           * `charge.refunded` fires for PARTIAL refunds too — the charge reports
           * `refunded: false` with a non-zero `amount_refunded`. Reading only the
           * event type is what makes a $10 goodwill refund look like a
           * cancellation.
           */
          refund: {
            amountRefundedCents: charge.amount_refunded ?? 0,
            chargeAmountCents: charge.amount ?? 0,
            fullyRefunded: charge.refunded === true,
          },
        } satisfies ProviderEvent;
      }

      const object = event.data.object as Partial<Stripe.Checkout.Session>;
      const paid =
        object.payment_status === "paid" || object.payment_status === "no_payment_required";

      return {
        id: event.id,
        type: event.type,
        sessionId: typeof object.id === "string" ? object.id : null,
        paymentStatus: object.payment_status ? toPaymentStatus(object.payment_status) : null,
        orderId: object.metadata?.[ORDER_ID_KEY] ?? null,
        livemode: event.livemode,
        email: object.customer_details?.email ?? null,
        shipping: object.id ? toShipping(object as Stripe.Checkout.Session) : null,
        shipCountry: object.collected_information?.shipping_details?.address?.country ?? null,
        /**
         * Only on a SETTLED session. An expiry carries zeros for every amount,
         * and copying those onto an order that already paid would blank out the
         * real figures — so the absence is modelled rather than defaulted.
         */
        amounts: paid
          ? {
              subtotalCents: object.amount_subtotal ?? 0,
              shippingCents: shippingOf(object),
              taxCents: taxOf(object),
              totalCents: object.amount_total ?? 0,
              currency: object.currency ?? "",
            }
          : null,
        paymentIntentId: paymentIntentOf(object),
        refund: null,
      } satisfies ProviderEvent;
    });

    return Payments.of({ createSession, retrieve, expire, parseEvent });
  }),
);
