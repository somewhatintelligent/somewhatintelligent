/**
 * The CUSTOMER surface.
 *
 * A separate contract from `Rpc.ts` on purpose. The two have different callers,
 * different trust, and different reasons to change:
 *
 *   OperatorRpcs   — the console. Bound, trusted, carries `meta.actor`, every
 *                    mutation audited and idempotency-keyed.
 *   StorefrontRpcs — the shop. Public, anonymous, and the ONLY writes it can
 *                    reach are "buy this cart" and nothing else.
 *
 * Collapsing them would mean one surface where a missing authorization check
 * exposes the whole order book rather than one checkout call. They are separate
 * because the blast radius of a mistake is different.
 */
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export class CartRefused extends Schema.TaggedErrorClass<CartRefused>()("CartRefused", {
  reason: Schema.Literals([
    "empty_cart",
    "invalid_quantity",
    "variant_not_found",
    "product_unavailable",
    "out_of_stock",
    /** The run is fully subscribed. Distinct from a shelf being empty. */
    "preorder_full",
    /** A duplicate of this exact request is already being processed. */
    "in_progress",
    "payments_unavailable",
  ]),
  detail: Schema.optional(Schema.String),
}) {}

export class OrderNotFound extends Schema.TaggedErrorClass<OrderNotFound>()("OrderNotFound", {
  orderNumber: Schema.String,
}) {}

/** Where a cart is going. Fixes the shipping rate and the address form. */
const Destination = Schema.Literals(["CA", "US"]);

const MediaRole = Schema.Literals(["cover", "gallery", "evidence"]);

/**
 * The storefront READS, declared rather than served as loose JSON.
 *
 * These were the only public reads without a schema: Catalog answered
 * `GET /products` and `/products/:slug` with `HttpServerResponse.json`, so the
 * shapes existed as hand-written interfaces in `Contracts.ts` with nothing
 * checking them and no client able to share them. Every consumer therefore had
 * to restate the shape and cast — which is exactly the hand-rolled boundary
 * this contract exists to make unnecessary.
 */
export const ProductCard = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
  priceCents: Schema.Number,
  version: Schema.String,
  coverHref: Schema.NullOr(Schema.String),
});

export const StorefrontProduct = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
  descriptionMarkdown: Schema.NullOr(Schema.String),
  priceCents: Schema.Number,
  version: Schema.String,
  media: Schema.Array(Schema.Struct({ href: Schema.String, alt: Schema.String, role: MediaRole })),
  /** `available` is DERIVED server-side from live stock and the pre-order run. */
  variants: Schema.Array(
    Schema.Struct({ id: Schema.String, size: Schema.String, available: Schema.Boolean }),
  ),
});

const PlacedOrder = Schema.Struct({
  orderNumber: Schema.String,
  /**
   * LINE ITEMS ONLY, and named so a storefront cannot mistake it for a total.
   * Shipping and tax are added on the payment page — what the buyer is charged
   * is not known until they finish there.
   */
  subtotalCents: Schema.Number,
  sessionId: Schema.String,
  /**
   * Where to send the buyer. `null` when the deployment runs the fake provider,
   * which hosts no payment page — so a storefront must branch rather than
   * redirect blindly.
   */
  checkoutUrl: Schema.NullOr(Schema.String),
});

/** What a customer may see about their own order. Never the internal id. */
const CustomerOrderView = Schema.Struct({
  orderNumber: Schema.String,
  status: Schema.Literals(["pending", "paid", "shipped", "delivered", "cancelled"]),
  paymentStatus: Schema.String,
  /**
   * The receipt. All four are zero until the order is paid, because shipping
   * and tax do not exist before then — a storefront showing an unpaid order
   * should render `subtotalCents` and say so.
   */
  subtotalCents: Schema.Number,
  shippingCents: Schema.Number,
  taxCents: Schema.Number,
  totalCents: Schema.Number,
  currency: Schema.String,
  carrier: Schema.NullOr(Schema.String),
  trackingNumber: Schema.NullOr(Schema.String),
  shippedAt: Schema.NullOr(Schema.Number),
  items: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      size: Schema.String,
      unitPriceCents: Schema.Number,
      quantity: Schema.Number,
      /** Told to the buyer before they paid, and kept afterwards. */
      preorder: Schema.Boolean,
      expectedShipAt: Schema.NullOr(Schema.Number),
    }),
  ),
});

export class StorefrontRpcs extends RpcGroup.make(
  /**
   * Buy a cart.
   *
   * `commandId` is the browser's retry key — a double-clicked Buy button must
   * not reserve stock twice, and this is what makes the retry a replay. Prices
   * are NOT accepted from the client; the active release is the authority.
   */
  Rpc.make("placeOrder", {
    payload: {
      commandId: Schema.String.check(Schema.isMinLength(1)),
      /**
       * BOUNDED, because this endpoint is anonymous and the value is persisted
       * twice per order — on `customer_order` and again in the command ledger.
       * 254 is the RFC 5321 limit for an address, so nothing legitimate is
       * refused and an unbounded string cannot be used to write megabytes into
       * two tables with a single unauthenticated call.
       */
      email: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(254)),
      /**
       * Chosen on the storefront BEFORE checkout opens, because it decides the
       * shipping rate and pins the address form to one country. Asking Stripe
       * to infer it from an address the buyer has not typed yet is not possible,
       * and offering both rates lets them pick the wrong one.
       */
      destination: Destination,
      /**
       * BOUNDED, and not only for taste. Pricing the cart issues an `inArray`
       * over the distinct variants, and D1 allows at most 100 bound parameters
       * per query — so an unbounded cart is a 500 anyone can trigger on the
       * public checkout endpoint by posting a long enough list. Twenty lines is
       * far above any real order and far below the limit.
       */
      items: Schema.Array(
        Schema.Struct({
          variantId: Schema.String,
          quantity: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
        }),
      ).check(Schema.isMaxLength(20)),
    },
    success: PlacedOrder,
    error: CartRefused,
  }),

  /**
   * Look up an order the customer already placed.
   *
   * The EMAIL IS REQUIRED and it is not a convenience. Order numbers are derived
   * from an id tail and are quoted in emails, receipts and support threads — on
   * their own they are a guessable, shareable handle, so a lookup keyed on the
   * number alone hands the order book to anyone willing to enumerate. Requiring
   * the address the order was placed with is the weakest check that is still a
   * check, and it is what an anonymous storefront can actually ask for.
   *
   * A mismatch returns `OrderNotFound`, the same error as a nonexistent order,
   * so the response never confirms that a number is real.
   */
  /**
   * The public catalog reads. Anonymous, no payload beyond a slug, and sourced
   * only from the ACTIVE RELEASE — a draft edit changes nothing here until it
   * is published.
   */
  Rpc.make("listStorefront", {
    payload: {},
    success: Schema.Array(ProductCard),
  }),

  Rpc.make("getStorefrontProduct", {
    payload: { slug: Schema.String },
    success: Schema.NullOr(StorefrontProduct),
  }),

  Rpc.make("getMyOrder", {
    payload: { orderNumber: Schema.String, email: Schema.String },
    success: CustomerOrderView,
    error: OrderNotFound,
  }),
) {}
