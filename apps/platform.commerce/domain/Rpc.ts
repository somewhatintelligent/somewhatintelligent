/**
 * The operator surface as a schema-validated RPC contract.
 *
 * THIS FILE IS THE BOUNDARY. Every payload that crosses it is decoded by
 * `Schema` before a handler sees it, and every failure a client can observe is a
 * `Schema.TaggedErrorClass` it can `match` on — not a status code, not a hand-
 * parsed JSON envelope, and never a cast.
 *
 * It replaces two things at once:
 *
 *  - v2's `Surface.ts`, a hand-written TypeScript interface that described the
 *    shape but validated nothing at runtime; and
 *  - the `{ ok, error }` result envelope, whose whole job was carrying domain
 *    conditions past a boundary that could not type them. Effect RPC types the
 *    error channel, so a domain condition IS a typed failure on the wire.
 *
 * The domain cores keep returning `DomainResult` values internally — that is
 * what lets a failure skip the audit write without unwinding a batch. The
 * handlers convert those values into typed failures exactly once, at the edge.
 */
import * as Schema from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

// ── Shared value objects ─────────────────────────────────────────────────────

export const ProductStatus = Schema.Literals(["draft", "active", "unavailable", "archived"]);

export const OrderStatus = Schema.Literals([
  "pending",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
]);

/**
 * The call envelope. `commandId` is the ONLY thing the browser supplies toward
 * idempotency — the edge namespaces it by actor and action, so a client cannot
 * assert an identity by choosing a key or collide with another actor's.
 */
export const CommandId = Schema.String.check(Schema.isMinLength(1));

export const ProductDraft = Schema.Struct({
  productId: Schema.String,
  slug: Schema.String,
  revision: Schema.Number,
  title: Schema.String,
  /** Always visible on the product page, directly under the title. */
  descriptionMarkdown: Schema.NullOr(Schema.String),
  /** The optional `Product details` panel. `null` means there is no panel. */
  detailsMarkdown: Schema.NullOr(Schema.String),
  /**
   * THE SIZE-GUIDE PLATE, flat rather than nested, because these four columns
   * are what an operator edits and any of them can be set while the others are
   * not. The RULE that binds them is one line and lives in the renderer: no
   * `sizeGuideAssetId`, no `Size & fit` accordion — alt text and fit comments
   * with nothing to caption are not a panel.
   */
  sizeGuideAssetId: Schema.NullOr(Schema.String),
  /** Derived from the id — the console renders the plate before publishing. */
  sizeGuideHref: Schema.NullOr(Schema.String),
  sizeGuideAlt: Schema.NullOr(Schema.String),
  sizeGuideNotesMarkdown: Schema.NullOr(Schema.String),
  status: ProductStatus,
  activeVersion: Schema.NullOr(Schema.String),
  updatedAt: Schema.Number,
});

/** A market this store sells into. Mirrors `core/markets.ts`. */
const Market = Schema.Literals(["CA", "US"]);

/**
 * One market's price and switch on the DRAFT — what the editor edits, and
 * what publish freezes into `product_release_market`. Absent from the list
 * page's rows: the list joining every product's market rows would spend
 * D1 bound parameters per product on a page capped at exactly the 100-param
 * cliff, and the list has no price column to spend them on.
 */
export const MarketPrice = Schema.Struct({
  market: Market,
  /** Minor units of THAT market's currency. Independent, not converted. */
  priceCents: Schema.Number,
  active: Schema.Boolean,
});

const VariantMode = Schema.Literals(["stock", "preorder"]);

export const ProductVariant = Schema.Struct({
  id: Schema.String,
  size: Schema.String,
  sku: Schema.String,
  /** Units left to sell — shelf stock, or unclaimed places in a run. */
  stock: Schema.Number,
  mode: VariantMode,
  expectedShipAt: Schema.NullOr(Schema.Number),
  available: Schema.Boolean,
});

/**
 * One product photograph. `position` is the ONLY presentation field — zero is
 * the listing cover and the shot the page opens on, the rest follow it in a
 * numbered filmstrip. There is no role, and adding one back would restore the
 * two-sources-of-truth problem `Schema.ts` describes.
 */
export const ProductMedia = Schema.Struct({
  id: Schema.String,
  productId: Schema.String,
  alt: Schema.String,
  position: Schema.Number,
  href: Schema.String,
  contentType: Schema.String,
  size: Schema.Number,
  sha256: Schema.String,
});

const ProductRelease = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  publishedAt: Schema.Number,
});

/**
 * The manufacturing run behind a pre-order. `cap: null` means this product is
 * not sold as a pre-order; `remaining` is what a storefront should render.
 */
const PreorderRun = Schema.Struct({
  cap: Schema.NullOr(Schema.Number),
  claimed: Schema.Number,
  remaining: Schema.NullOr(Schema.Number),
});

export const ProductDetail = Schema.Struct({
  draft: ProductDraft,
  /** Where this draft would sell, and at what, if published now. */
  markets: Schema.Array(MarketPrice),
  preorder: PreorderRun,
  releases: Schema.Array(ProductRelease),
  variants: Schema.Array(ProductVariant),
  media: Schema.Array(ProductMedia),
});

export const ProductPage = Schema.Struct({
  products: Schema.Array(ProductDraft),
  nextCursor: Schema.NullOr(Schema.String),
});

export const ShippingAddress = Schema.Struct({
  name: Schema.String,
  line1: Schema.String,
  line2: Schema.optional(Schema.String),
  city: Schema.String,
  region: Schema.String,
  postal: Schema.String,
  country: Schema.Literals(["CA", "US"]),
  phone: Schema.optional(Schema.String),
});

const OrderLine = Schema.Struct({
  productId: Schema.String,
  variantId: Schema.String,
  preorder: Schema.Boolean,
  expectedShipAt: Schema.NullOr(Schema.Number),
  title: Schema.String,
  size: Schema.String,
  unitPriceCents: Schema.Number,
  quantity: Schema.Number,
});

export const OrderDetail = Schema.Struct({
  /** Joins this order to the payment provider — it is what the session metadata carries. */
  orderId: Schema.String,
  orderNumber: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  customerId: Schema.String,
  email: Schema.String,
  receiptEmail: Schema.NullOr(Schema.String),
  status: OrderStatus,
  paymentStatus: Schema.String,
  subtotalCents: Schema.Number,
  shippingCents: Schema.Number,
  taxCents: Schema.Number,
  totalCents: Schema.Number,
  currency: Schema.String,
  refundedCents: Schema.Number,
  shipCountry: Schema.String,
  shipping: Schema.NullOr(ShippingAddress),
  carrier: Schema.NullOr(Schema.String),
  trackingNumber: Schema.NullOr(Schema.String),
  fulfillmentNote: Schema.NullOr(Schema.String),
  shippedAt: Schema.NullOr(Schema.Number),
  deliveredAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  items: Schema.Array(OrderLine),
});

/**
 * One thing that happened to an order. `source` separates what a PERSON did
 * from what the provider REPORTED — an audit trail that conflates the two
 * cannot answer the question it exists for.
 */
const TimelineEntry = Schema.Struct({
  at: Schema.Number,
  source: Schema.Literals(["operator", "customer", "payment"]),
  action: Schema.String,
  actor: Schema.NullOr(Schema.String),
  outcome: Schema.String,
  detail: Schema.NullOr(Schema.String),
});

const OrderSummary = Schema.Struct({
  orderNumber: Schema.String,
  email: Schema.String,
  shipName: Schema.NullOr(Schema.String),
  totalCents: Schema.Number,
  status: OrderStatus,
  paymentStatus: Schema.String,
  createdAt: Schema.Number,
});

export const OrderPage = Schema.Struct({
  orders: Schema.Array(OrderSummary),
  nextCursor: Schema.NullOr(Schema.String),
});

/**
 * One aggregated line of demand from PAID, unshipped orders.
 *
 * Identity and buyer-facing copy are both retained. The ids prevent two
 * products with the same title and size from collapsing together; the snapshots
 * keep the summary readable after catalog copy changes or deletion.
 */
const FulfillmentDemandLine = Schema.Struct({
  productId: Schema.String,
  variantId: Schema.String,
  title: Schema.String,
  size: Schema.String,
  quantity: Schema.Number,
  preorder: Schema.Boolean,
  expectedShipAt: Schema.NullOr(Schema.Number),
});

/** The complete, unpaginated work represented by orders in `paid`. */
export const FulfillmentDemand = Schema.Struct({
  orderCount: Schema.Number,
  unitCount: Schema.Number,
  lines: Schema.Array(FulfillmentDemandLine),
});

export const DeletionImpact = Schema.Struct({
  targetType: Schema.Literals(["product", "product_release", "product_variant", "media"]),
  targetId: Schema.String,
  label: Schema.String,
  activeReleaseAffected: Schema.Boolean,
  deleteCounts: Schema.Record(Schema.String, Schema.Number),
  retainedCounts: Schema.Record(Schema.String, Schema.Number),
  warnings: Schema.Array(Schema.String),
});

export const DeletionPlan = Schema.Struct({
  impact: DeletionImpact,
  confirmationToken: Schema.String,
  expiresAt: Schema.Number,
});

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * One error class per domain condition, carrying only what a caller can act on.
 *
 * These are NOT infrastructure failures — a missing product is a normal outcome
 * an operator console renders, so it belongs on the typed error channel where a
 * client must handle it, rather than in a 500.
 */
export class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
  what: Schema.String,
  id: Schema.String,
}) {}

export class InvalidCursor extends Schema.TaggedErrorClass<InvalidCursor>()("InvalidCursor", {
  cursor: Schema.String,
}) {}

export class SlugTaken extends Schema.TaggedErrorClass<SlugTaken>()("SlugTaken", {
  slug: Schema.String,
}) {}

export class InvalidPrice extends Schema.TaggedErrorClass<InvalidPrice>()("InvalidPrice", {
  priceCents: Schema.Number,
}) {}

/** Optimistic concurrency lost. The caller should re-read and retry. */
export class RevisionConflict extends Schema.TaggedErrorClass<RevisionConflict>()(
  "RevisionConflict",
  { expected: Schema.Number },
) {}

export class PublishRefused extends Schema.TaggedErrorClass<PublishRefused>()("PublishRefused", {
  reason: Schema.Literals([
    "invalid_version",
    "version_exists",
    "missing_media",
    "missing_variant",
    /**
     * No market row on the draft — the release would be on sale nowhere, in no
     * currency, which is a broken listing wearing a green publish button.
     */
    "missing_market",
    "no_release",
    /**
     * Going ACTIVE with pre-order variants and no run cap. The run guard
     * requires `preorder_cap IS NOT NULL`, so such a product refuses every
     * checkout forever while looking perfectly normal on the shelf.
     */
    "preorder_cap_missing",
  ]),
}) {}

export class VariantRefused extends Schema.TaggedErrorClass<VariantRefused>()("VariantRefused", {
  reason: Schema.Literals(["sku_taken", "size_taken", "invalid_stock", "negative_stock"]),
}) {}

export class PreorderRefused extends Schema.TaggedErrorClass<PreorderRefused>()("PreorderRefused", {
  reason: Schema.Literals([
    "invalid_cap",
    "cap_below_claimed",
    /** Clearing the cap on a LIVE product whose variants are still pre-order. */
    "preorder_cap_missing",
  ]),
  detail: Schema.optional(Schema.String),
}) {}

export class MediaRefused extends Schema.TaggedErrorClass<MediaRefused>()("MediaRefused", {
  reason: Schema.Literals([
    /**
     * Outside the display allowlist — the same one for every image this store
     * holds, photography and size guides alike. The only thing refused is a
     * format a browser will not render.
     */
    "unsupported_type",
    "invalid_size",
    "storage_unavailable",
    "invalid_order",
  ]),
  detail: Schema.optional(Schema.String),
}) {}

export class OrderRefused extends Schema.TaggedErrorClass<OrderRefused>()("OrderRefused", {
  reason: Schema.Literals(["invalid_transition", "payment_incomplete", "already_fulfilled"]),
  detail: Schema.optional(Schema.String),
}) {}

/**
 * Every way a confirm-delete can be refused.
 *
 * `mismatch` deliberately covers unknown token, wrong operator AND wrong action:
 * splitting them for a better message would leak whether a token exists and who
 * owns it. `drift` is the interesting one — it means the world changed between
 * plan and confirm, and re-planning is the normal response.
 */
export class DeletionRefused extends Schema.TaggedErrorClass<DeletionRefused>()("DeletionRefused", {
  reason: Schema.Literals([
    "expired",
    "mismatch",
    "already_executed",
    "drift",
    "invalid_replacement",
  ]),
}) {}

/** A payment event, as the settlement path sees it. */
export const ProviderEventPayload = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  paymentStatus: Schema.NullOr(Schema.Literals(["unpaid", "paid", "no_payment_required"])),
  orderId: Schema.NullOr(Schema.String),
  livemode: Schema.Boolean,
  email: Schema.NullOr(Schema.String),
  shipping: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      line1: Schema.String,
      line2: Schema.NullOr(Schema.String),
      city: Schema.String,
      region: Schema.String,
      postal: Schema.String,
      phone: Schema.NullOr(Schema.String),
    }),
  ),
  shipCountry: Schema.NullOr(Schema.String),
  /** Present only on a settling event — see `ProviderEvent.amounts`. */
  amounts: Schema.NullOr(
    Schema.Struct({
      subtotalCents: Schema.Number,
      shippingCents: Schema.Number,
      taxCents: Schema.Number,
      totalCents: Schema.Number,
      currency: Schema.String,
    }),
  ),
  paymentIntentId: Schema.NullOr(Schema.String),
  /** Present only on a reversal — see `ProviderEvent.refund`. */
  refund: Schema.NullOr(
    Schema.Struct({
      amountRefundedCents: Schema.Number,
      chargeAmountCents: Schema.Number,
      fullyRefunded: Schema.Boolean,
    }),
  ),
});

const SweepResult = Schema.Struct({
  orphansReleased: Schema.Number,
  healed: Schema.Number,
  released: Schema.Number,
  inconclusive: Schema.Number,
  /** The run hit its bound — more work is waiting for the next one. */
  remaining: Schema.Boolean,
});

const SettleResult = Schema.Struct({
  outcome: Schema.Literals(["applied", "duplicate", "ignored", "retryable", "dead"]),
  orderNumber: Schema.NullOr(Schema.String),
});

// ── Procedures ───────────────────────────────────────────────────────────────

const call = <F extends Schema.Struct.Fields>(fields: F) => ({
  commandId: CommandId,
  ...fields,
});

/**
 * Twenty-nine procedures. Reads take no `commandId` — they have nothing to
 * replay — which is itself part of the contract rather than a convention.
 */
export class OperatorRpcs extends RpcGroup.make(
  // Catalog reads
  Rpc.make("listProducts", {
    payload: {
      status: Schema.optional(Schema.Union([ProductStatus, Schema.Literal("all")])),
      limit: Schema.optional(Schema.Number),
      cursor: Schema.optional(Schema.String),
    },
    success: ProductPage,
    error: InvalidCursor,
  }),
  Rpc.make("getProduct", {
    payload: { productId: Schema.String },
    success: ProductDetail,
    error: NotFound,
  }),

  // Product lifecycle
  Rpc.make("createProduct", {
    payload: call({
      slug: Schema.String.check(Schema.isMinLength(1)),
      title: Schema.String.check(Schema.isMinLength(1)),
      descriptionMarkdown: Schema.optional(Schema.NullOr(Schema.String)),
    }),
    success: Schema.Struct({ productId: Schema.String, revision: Schema.Number }),
    error: SlugTaken,
  }),
  Rpc.make("saveProductDraft", {
    payload: call({
      productId: Schema.String,
      expectedRevision: Schema.Int,
      title: Schema.optional(Schema.String),
      descriptionMarkdown: Schema.optional(Schema.NullOr(Schema.String)),
      /**
       * The `Product details` panel's copy. `null` REMOVES the panel; omitting
       * the field leaves it alone. That distinction is the whole reason these
       * are `optional(NullOr(...))` rather than `optional(String)` — an editor
       * clearing a textarea and an editor not touching it are different edits.
       */
      detailsMarkdown: Schema.optional(Schema.NullOr(Schema.String)),
      /** The plate's alt text and fit comments. The ASSET moves through its own call. */
      sizeGuideAlt: Schema.optional(Schema.NullOr(Schema.String)),
      sizeGuideNotesMarkdown: Schema.optional(Schema.NullOr(Schema.String)),
      slug: Schema.optional(Schema.String),
      /**
       * Upserted per (product, market) under the same revision guard as the
       * copy. Omitted markets are left alone; there is no delete, because
       * `active: false` is "stop selling" with the price kept.
       */
      markets: Schema.optional(
        Schema.Array(
          Schema.Struct({
            market: Market,
            priceCents: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
            active: Schema.Boolean,
          }),
        ),
      ),
    }),
    success: Schema.Struct({ revision: Schema.Number, updatedAt: Schema.Number }),
    error: Schema.Union([NotFound, RevisionConflict, SlugTaken, InvalidPrice]),
  }),
  Rpc.make("publishProduct", {
    payload: call({
      productId: Schema.String,
      expectedRevision: Schema.Int,
      /**
       * OPTIONAL. Omit it and the server derives the next one — the version is a
       * label for humans, not a key the caller has to invent on every publish.
       */
      version: Schema.optional(Schema.String),
      /**
       * WHICH PART MOVES when the version is derived. Ignored when `version` is
       * supplied, because then the caller has already said. Defaults to `minor`,
       * which is what a release usually is.
       */
      bump: Schema.optional(Schema.Literals(["major", "minor", "patch"])),
    }),
    success: Schema.Struct({
      releaseId: Schema.String,
      version: Schema.String,
      publishedAt: Schema.Number,
    }),
    error: Schema.Union([NotFound, RevisionConflict, PublishRefused]),
  }),
  Rpc.make("setProductStatus", {
    payload: call({ productId: Schema.String, status: ProductStatus }),
    success: Schema.Struct({ status: ProductStatus }),
    error: Schema.Union([NotFound, PublishRefused]),
  }),

  // Variants and inventory
  Rpc.make("putVariant", {
    payload: call({
      productId: Schema.String,
      variantId: Schema.optional(Schema.String),
      size: Schema.String.check(Schema.isMinLength(1)),
      sku: Schema.String.check(Schema.isMinLength(1)),
      /**
       * Units this variant may sell. For `preorder` this is the SIZE OF THE RUN
       * — how many garments will be made — so the same conditional decrement
       * that stops an oversell stops an over-subscription.
       *
       * OPTIONAL, and on an UPDATE it is an ABSOLUTE write from whatever the
       * caller last read. Omit it to leave inventory alone; `adjustStock` moves
       * it by a relative delta and is the only safe way to do so while the
       * store is taking orders. Supplying it here to "correct" a count races
       * every checkout in flight.
       *
       * Absent on create means zero.
       */
      stock: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
      mode: Schema.optional(VariantMode),
      expectedShipAt: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
    success: Schema.Struct({ variantId: Schema.String }),
    error: Schema.Union([NotFound, VariantRefused]),
  }),
  /**
   * Open, resize or close a product's pre-order run. The cap is an AGGREGATE
   * across every variant — one run makes N garments, however the sizes fall.
   */
  Rpc.make("setPreorderCap", {
    payload: call({
      productId: Schema.String,
      cap: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    }),
    success: PreorderRun,
    error: Schema.Union([NotFound, PreorderRefused]),
  }),
  Rpc.make("adjustStock", {
    payload: call({
      variantId: Schema.String,
      delta: Schema.Int,
      reason: Schema.String,
    }),
    success: Schema.Struct({ stock: Schema.Number }),
    error: Schema.Union([NotFound, VariantRefused]),
  }),

  // Media
  /** APPENDED at the end of the order. `reorderProductMedia` is the only mover. */
  Rpc.make("ingestProductMedia", {
    payload: call({
      productId: Schema.String,
      /** Base64 — the wire has no binary frame, and the schema says so. */
      bytesBase64: Schema.String,
      contentType: Schema.String,
      alt: Schema.String,
    }),
    success: ProductMedia,
    error: Schema.Union([NotFound, MediaRefused]),
  }),

  Rpc.make("reorderProductMedia", {
    payload: call({ productId: Schema.String, mediaIds: Schema.Array(Schema.String) }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: Schema.Union([NotFound, MediaRefused]),
  }),

  /**
   * THE SIZE-GUIDE PLATE — upload or replace, one per product.
   *
   * Its own pair of calls rather than a flag on `ingestProductMedia`, because
   * it is not a photograph of the object: it never joins the ordered set, is
   * never the cover, and is served only behind `Size & fit`. It also carries no
   * `position` to append at and no alt of its own — the alt and the fit
   * comments are draft copy that `publishProduct` freezes, and move through
   * `saveProductDraft`.
   */
  Rpc.make("putProductSizeGuide", {
    payload: call({
      productId: Schema.String,
      /** Base64, like product media, and the same display allowlist. */
      bytesBase64: Schema.String,
      contentType: Schema.String,
    }),
    success: Schema.Struct({ sizeGuideAssetId: Schema.String, href: Schema.String }),
    error: Schema.Union([NotFound, MediaRefused]),
  }),

  /**
   * Take the plate off the DRAFT. The asset row and its bytes go too — UNLESS a
   * published release still names them, in which case they are RETAINED and
   * `retainedForReleases` says how many. A chart must never disappear out of
   * what a buyer was shown, so the alternative to retaining is refusing, and
   * refusing would leave an operator unable to edit their own draft.
   */
  Rpc.make("removeProductSizeGuide", {
    payload: call({ productId: Schema.String }),
    success: Schema.Struct({
      removed: Schema.Boolean,
      retainedForReleases: Schema.Number,
    }),
    error: NotFound,
  }),

  // Orders
  Rpc.make("listOrders", {
    payload: {
      status: Schema.optional(Schema.Union([OrderStatus, Schema.Literal("all")])),
      limit: Schema.optional(Schema.Number),
      cursor: Schema.optional(Schema.String),
    },
    success: OrderPage,
    error: InvalidCursor,
  }),
  Rpc.make("getOrder", {
    payload: { orderNumber: Schema.String },
    success: OrderDetail,
    error: NotFound,
  }),
  Rpc.make("fulfillmentDemand", {
    payload: {},
    success: FulfillmentDemand,
  }),
  /**
   * The full history of an order, merged from both append-only logs.
   *
   * The order row holds only the LATEST value of every field — a corrected
   * tracking number overwrites the one that was emailed, a refund overwrites the
   * fact money once arrived. This is where those stay reachable.
   */
  Rpc.make("orderTimeline", {
    payload: { orderNumber: Schema.String },
    success: Schema.Array(TimelineEntry),
    error: NotFound,
  }),
  Rpc.make("setOrderStatus", {
    payload: call({
      orderNumber: Schema.String,
      status: Schema.Literals(["paid", "cancelled"]),
    }),
    success: OrderDetail,
    error: Schema.Union([NotFound, OrderRefused]),
  }),
  Rpc.make("fulfillOrder", {
    payload: call({
      orderNumber: Schema.String,
      carrier: Schema.String.check(Schema.isMinLength(1)),
      trackingNumber: Schema.String.check(Schema.isMinLength(1)),
      note: Schema.optional(Schema.String),
    }),
    success: OrderDetail,
    error: Schema.Union([NotFound, OrderRefused]),
  }),
  Rpc.make("markDelivered", {
    payload: call({ orderNumber: Schema.String }),
    success: OrderDetail,
    error: Schema.Union([NotFound, OrderRefused]),
  }),

  // Deletion — four plan/confirm pairs
  Rpc.make("planProductReleaseDeletion", {
    payload: call({
      productId: Schema.String,
      releaseId: Schema.String,
      replacementReleaseId: Schema.optional(Schema.NullOr(Schema.String)),
    }),
    success: DeletionPlan,
    error: Schema.Union([NotFound, DeletionRefused]),
  }),
  Rpc.make("deleteProductRelease", {
    payload: call({ confirmationToken: Schema.String }),
    success: Schema.Struct({
      deleted: Schema.Boolean,
      activeVersion: Schema.NullOr(Schema.String),
    }),
    error: Schema.Union([NotFound, DeletionRefused]),
  }),
  Rpc.make("planProductDeletion", {
    payload: call({ productId: Schema.String }),
    success: DeletionPlan,
    error: NotFound,
  }),
  Rpc.make("deleteProduct", {
    payload: call({ confirmationToken: Schema.String }),
    success: Schema.Struct({ deleted: Schema.Boolean }),
    error: Schema.Union([NotFound, DeletionRefused]),
  }),
  Rpc.make("planVariantDeletion", {
    payload: call({ productId: Schema.String, variantId: Schema.String }),
    success: DeletionPlan,
    error: NotFound,
  }),
  Rpc.make("deleteVariant", {
    payload: call({ confirmationToken: Schema.String }),
    success: Schema.Struct({ deleted: Schema.Boolean }),
    error: Schema.Union([NotFound, DeletionRefused]),
  }),
  Rpc.make("planProductMediaDeletion", {
    payload: call({ productId: Schema.String, mediaId: Schema.String }),
    success: DeletionPlan,
    error: NotFound,
  }),
  Rpc.make("deleteProductMedia", {
    payload: call({ confirmationToken: Schema.String }),
    success: Schema.Struct({ deleted: Schema.Boolean, productStatus: ProductStatus }),
    error: Schema.Union([NotFound, DeletionRefused]),
  }),

  /**
   * Maintenance. Both are genuine operator capabilities rather than test hooks:
   * a console wants a "run reconciliation now" button, and replaying a stuck
   * provider event by hand is standard payment ops. They run the SAME functions
   * the cron and the queue consumer do.
   */
  Rpc.make("runSweep", { payload: {}, success: SweepResult }),
  Rpc.make("replayEvent", {
    payload: { event: ProviderEventPayload, attempt: Schema.Int },
    success: SettleResult,
  }),
) {}
