/**
 * The store's D1 schema. Every timestamp is an integer of unix MILLISECONDS and
 * every monetary column is an integer of minor units (cents). There is no
 * decimal or float type anywhere. A price column's CURRENCY is decided by the
 * market row it sits on — see `product_release_market` — and an order records
 * the currency it was actually quoted in.
 *
 * The product aggregate is a RELEASE MODEL: a thin `product` identity row, one
 * mutable `product_draft` working copy, N immutable-while-retained
 * `product_release` snapshots, `product_image` rows, and a
 * `product_release_image` join that freezes the image set at publish time.
 *
 * BYTES ARE ONE TABLE; USES ARE ANOTHER. `product_asset` holds every image the
 * store keeps and IS the `/media/<id>` address. What an asset is FOR is a
 * referencing row: `product_image` makes it ordered photography, and
 * `product_draft.size_guide_asset_id` makes one the measurement chart. The two
 * uses differ only in lifecycle — photography cascades with its product, a
 * chart is retained while a release still names it — which is a foreign key
 * each, not a table each.
 *
 * MEDIA IS ORDERED, NEVER LABELLED. `product_image.position` is the whole
 * presentation model — zero is the listing cover and the first thing a shopper
 * sees, the rest follow it in a numbered filmstrip. There is no `role` column,
 * because a label beside an order is a second source of truth for the same
 * question.
 *
 * Deliberately absent versus v2: no `store_media_gc_outbox` and no
 * `dead_stripe_event`. Media deletes remove the R2 object inline, and a payment
 * event that exhausts its attempts is written to `payment_event` with a `dead`
 * outcome rather than routed to a second queue.
 *
 * Status domains are spelled locally rather than imported: drizzle-kit loads
 * this file through a CJS loader, so anything it imports has to be loader-safe.
 */
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"] as const;

/**
 * `unavailable` is a published product pulled from sale, which is NOT the same
 * thing as `archived`. The CHECK below is the authoritative domain.
 */
const PRODUCT_STATUSES = ["draft", "active", "unavailable", "archived"] as const;

/**
 * How a variant's remaining count should be READ.
 *
 * The store sells against a counter either way; this says what the counter
 * means. A `preorder` variant has no physical units behind it — the cap is how
 * many garments the run will produce, and the buyer is told so before paying.
 */
const VARIANT_MODES = ["stock", "preorder"] as const;

// ── Catalog ──────────────────────────────────────────────────────────────────

/**
 * Product identity, thin by design: copy, price, and media live in the draft,
 * release, and image rows. `active_release_id` points at the live immutable
 * release and is null while the product is draft-only, or after its active
 * release is deleted.
 *
 * `product.active_release_id → product_release.id` and
 * `product_release.product_id → product.id` form a CIRCULAR foreign key. The
 * explicit `(): AnySQLiteColumn =>` return type is what breaks drizzle's
 * inference on that cycle.
 */
export const product = sqliteTable(
  "product",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    status: text("status", { enum: PRODUCT_STATUSES }).notNull().default("draft"),
    activeReleaseId: text("active_release_id").references(
      (): AnySQLiteColumn => productRelease.id,
      { onDelete: "set null" },
    ),
    /**
     * THE PRE-ORDER RUN, and it is deliberately a PRODUCT-level number.
     *
     * A manufacturing run is one decision — "make 200 of this shirt" — and only
     * afterwards is it a question of how many are smalls. So the cap that binds
     * is the aggregate across every variant, and per-variant `stock` is a
     * secondary limit on top of it (set it high, or to the run size, when only
     * the aggregate matters).
     *
     * Modelling it per-variant instead would mean 200 in aggregate could be
     * anything from 200 to 1,400 depending on how the sizes were configured —
     * which is not a cap.
     *
     * `null` means this product is not sold as a pre-order at all.
     */
    preorderCap: integer("preorder_cap"),
    /**
     * Places SOLD against that run, incremented under the same conditional
     * guard that decrements variant stock. Never derived by counting orders: a
     * COUNT is not atomic against a concurrent checkout, and this number is what
     * makes over-subscribing a run unrepresentable rather than merely unlikely.
     */
    preorderClaimed: integer("preorder_claimed").notNull().default(0),
    createdBySub: text("created_by_sub").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    // Serves the listProducts keyset page, which orders on
    // (status filter, updated_at, id) and scans this index in reverse.
    index("idx_product_status_updated").on(t.status, t.updatedAt),
    check("preorder_claimed_non_negative", sql`preorder_claimed >= 0`),
    check(
      "preorder_claimed_within_cap",
      sql`preorder_cap IS NULL OR preorder_claimed <= preorder_cap`,
    ),
    check("product_status_valid", sql`status IN ('draft', 'active', 'unavailable', 'archived')`),
  ],
);

/**
 * BYTES, AND ONLY BYTES — every image this store holds, in one table.
 *
 * An asset row IS the media identity: `/media/<id>` names exactly this row, and
 * `Contracts.mediaHref` spells that one address for every image because there
 * genuinely is one address space rather than two pretending to be one.
 *
 * WHAT USE AN ASSET IS PUT TO LIVES ELSEWHERE, which is the whole point of the
 * split. {@link productImage} makes an asset ordered product photography;
 * `product_draft.size_guide_asset_id` makes one the measurement chart. Those
 * two uses have genuinely different LIFECYCLES — photography cascades away with
 * its product, a chart is retained while a published release still names it —
 * and that difference is expressed by the referencing rows, not by forking the
 * bytes.
 *
 * The first cut of this schema DID fork them: a `product_size_guide` table
 * column-for-column identical to `product_image` minus `alt` and `position`.
 * The lifecycle difference justified separating the REFERENCES; it never
 * justified separating the identity. Duplicating it meant `/media/:id` — the
 * public, unauthenticated, highest-volume path in this app — probing two tables
 * in a union, `deriveProductImpact` having to remember two sets of storage keys
 * to avoid orphaning R2 objects, and a third asset kind costing a third table.
 *
 * `storage_key` is the opaque R2 key: unique, never in a DTO, and shaped
 * `products/{productId}/{assetId}` so a product delete still clears one prefix.
 *
 * NO `alt` AND NO `position` HERE. Both are things a USE has, not things bytes
 * have — and the size guide's alt is EDITORIAL CONTENT that has to freeze with
 * a release the way a description does, so it lives on {@link productDraft} and
 * {@link productRelease} beside the reference and the fit comments.
 */
export const productAsset = sqliteTable(
  "product_asset",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    contentSha256: text("content_sha256").notNull(),
    /** Any type in the store's display allowlist — see `domain/Media.ts`. */
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    /** Every per-product sweep — the ordered gallery scan, the delete impact. */
    index("idx_product_asset_product").on(t.productId),
    check("product_asset_size_non_negative", sql`size_bytes >= 0`),
  ],
);

/**
 * The editable working copy — exactly one per product, which is why
 * `product_id` is the primary key. `revision` bumps by one per save and is the
 * optimistic-concurrency token for `saveProductDraft` and `publishProduct`.
 * No public or checkout read ever touches this table; those read the active
 * release.
 */
export const productDraft = sqliteTable(
  "product_draft",
  {
    productId: text("product_id")
      .primaryKey()
      .references(() => product.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    title: text("title").notNull(),
    /** Always visible on the product page, directly under the title. */
    descriptionMarkdown: text("description_markdown"),
    /**
     * The optional `Product details` panel. NULL means the accordion does not
     * exist — not an empty one, and not a placeholder.
     */
    detailsMarkdown: text("details_markdown"),
    /**
     * The optional `Size & fit` panel, which is THREE nullable fields and one
     * rule: no asset, no accordion. The alt text and the fit comments sit here
     * rather than on the asset row because they are content an operator writes
     * and a release freezes, exactly like the description.
     */
    sizeGuideAssetId: text("size_guide_asset_id").references(() => productAsset.id, {
      onDelete: "set null",
    }),
    sizeGuideAlt: text("size_guide_alt"),
    sizeGuideNotesMarkdown: text("size_guide_notes_markdown"),
    updatedBySub: text("updated_by_sub").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  () => [check("product_draft_revision_min", sql`revision >= 1`)],
);

/**
 * PRICE AND AVAILABILITY PER MARKET — the editable side, mirroring the
 * draft/release split the copy already has. Edited under the draft's revision
 * guard and published into {@link releaseMarket}.
 *
 * There is deliberately NO price column on the draft or release row any more:
 * two places a price can live is the second-source-of-truth problem, and this
 * table is the one that survived.
 */
export const draftMarket = sqliteTable(
  "product_draft_market",
  {
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    /** A `MarketCode` from `core/markets.ts`. Constant, so no market table. */
    market: text("market").notNull(),
    /** Minor units of THAT MARKET'S currency. Independent prices, not conversions. */
    priceCents: integer("price_cents").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.market] }),
    check("product_draft_market_price_non_negative", sql`price_cents >= 0`),
  ],
);

/**
 * A published snapshot, immutable while retained. Checkout and every public
 * read source title and price from the product's ACTIVE release. A release may
 * be deleted but is never mutated in place, which is what makes
 * UNIQUE(product_id, version) a real constraint rather than a courtesy check.
 */
export const productRelease = sqliteTable(
  "product_release",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    descriptionMarkdown: text("description_markdown"),
    detailsMarkdown: text("details_markdown"),
    /**
     * THE ASSET REFERENCE IS FROZEN, THE BYTES ARE SHARED — the same trade
     * {@link productReleaseImage} makes, and for the same reason: republishing
     * an unchanged chart should cost a column, not a second copy in R2.
     *
     * `restrict` rather than `cascade`, and it is the one place in this schema
     * where the two differ in intent. A published release is what a buyer saw;
     * a chart silently vanishing out of it because someone tidied the draft is
     * the exact failure this constraint exists to make impossible. So the
     * database refuses the delete, and `removeProductSizeGuide` clears the
     * DRAFT's reference while retaining an asset any release still names.
     */
    sizeGuideAssetId: text("size_guide_asset_id").references(() => productAsset.id, {
      onDelete: "restrict",
    }),
    sizeGuideAlt: text("size_guide_alt"),
    sizeGuideNotesMarkdown: text("size_guide_notes_markdown"),
    publishedBySub: text("published_by_sub").notNull(),
    publishedAt: integer("published_at").notNull(),
  },
  (t) => [
    uniqueIndex("product_release_product_version_unique").on(t.productId, t.version),
    /**
     * WHICH RELEASES STILL NAME THIS PLATE — the read behind the retain rule
     * above, and it runs on every size-guide replace and remove. Without it
     * that is a full scan of every release the store has ever published.
     */
    index("idx_product_release_size_guide").on(t.sizeGuideAssetId),
  ],
);

/**
 * PRICE AND AVAILABILITY PER MARKET, snapshotted with the release for the same
 * reason the title is: what a buyer was charged must never be rewritten by a
 * later edit.
 *
 * `price_cents` is minor units of THAT MARKET'S currency — 8500 under CA is
 * $85 CAD, 7500 under US is $75 USD. They are two independent prices, not one
 * converted, because the gap between them is a deliberate decision about who
 * absorbs the tariff.
 *
 * NO ROW means this release is not sold in that market — a real state, not an
 * error, and the storefront and checkout both fail closed on it. `active` is
 * the softer version: keep the price, stop selling, put it back later — the
 * per-market kill switch, and it needs no deploy.
 */
export const releaseMarket = sqliteTable(
  "product_release_market",
  {
    releaseId: text("release_id")
      .notNull()
      .references(() => productRelease.id, { onDelete: "cascade" }),
    market: text("market").notNull(),
    priceCents: integer("price_cents").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.market] }),
    check("product_release_market_price_non_negative", sql`price_cents >= 0`),
  ],
);

/**
 * Product media. `storage_key` is the opaque R2 key: it never appears in a DTO,
 * a URL, or an RPC type, and it is unique.
 *
 * There is no `state` column. v2 modelled a pending → ready → failed upload
 * lifecycle because bytes travelled through a separate service; here the bytes
 * are written to R2 in the same call that inserts the row, so a row that exists
 * is servable by construction.
 *
 * THERE IS NO `role` COLUMN, AND THAT IS THE MODEL RATHER THAN AN OMISSION.
 *
 * `cover` / `gallery` / `evidence` asked an operator to answer a question the
 * ORDER already answers, and then let the two disagree: an image could be
 * `gallery` at position 0 and `cover` at position 2, so "which picture leads"
 * had two sources of truth and a tie-break rule between them. POSITION ZERO IS
 * THE COVER. Everything else follows it, numbered, in the filmstrip. One fact,
 * one column, nothing to reconcile.
 */
export const productImage = sqliteTable(
  "product_image",
  {
    /**
     * THE ASSET IS THE IMAGE. This row adds a USE to bytes that already exist —
     * an order and an alt — so it holds no id of its own: the asset's id is the
     * media address, the release-membership key, and the primary key here.
     *
     * `cascade` because photography belongs to its product and goes with it.
     * The size guide's reference is `RESTRICT` instead, and that difference in
     * ONE WORD is the whole reason the two uses are separate tables while the
     * bytes are not.
     */
    assetId: text("asset_id")
      .primaryKey()
      .references(() => productAsset.id, { onDelete: "cascade" }),
    alt: text("alt").notNull(),
    /**
     * THE ONLY THING THAT DECIDES PRESENTATION. Zero leads; the rest follow.
     * `ingestProductMedia` appends at the end and `reorderProductMedia` is the
     * only way to change it.
     */
    position: integer("position").notNull().default(0),
  },
  (t) => [
    /**
     * NOT UNIQUE ON position, DELIBERATELY.
     *
     * A reorder is N `SET position = ?` statements in one batch, and SQLite
     * checks a UNIQUE index after EACH statement rather than at commit — so
     * swapping two images collides on the intermediate state and aborts the
     * whole batch. The constraint would make the ordinary gesture fail while
     * protecting against nothing: a duplicate position is a display tie, not a
     * corruption, and every read orders on `(position, asset_id)` so the tie
     * resolves deterministically anyway.
     *
     * Product scoping comes from the JOIN to `product_asset` rather than from a
     * `product_id` copied down here. A second column naming the owner is a
     * second thing that can disagree with the first, and this table has no
     * lifecycle of its own in which it could legitimately differ.
     */
    index("idx_product_image_position").on(t.position),
    check("product_image_position_non_negative", sql`position >= 0`),
  ],
);

/**
 * The image set a release was published with — MEMBERSHIP AND ORDER, not bytes.
 *
 * A join row per (release, image) carrying the alt and position as they stood
 * at publish time. The bytes live once in R2 under
 * `products/{productId}/{imageId}` no matter how many releases include them, so
 * publishing ten times costs ten small rows and zero extra storage.
 *
 * WHAT IT ACTUALLY PROTECTS AGAINST, stated precisely because the distinction
 * matters: reordering media, changing alt text, or adding and removing images on
 * the DRAFT leaves published releases untouched. Deleting the underlying image
 * does NOT — the foreign key cascades and every release containing it loses it.
 * That is a deliberate, surfaced choice rather than a silent one:
 * `planProductMediaDeletion` counts the affected releases and warns before an
 * operator confirms. The SIZE-GUIDE plate is the deliberate exception and
 * refuses instead — see {@link productRelease.sizeGuideAssetId}, where the asset
 * is one shared row rather than a per-release copy of the membership.
 *
 * The composite primary key means an image appears at most once per release.
 */
export const productReleaseImage = sqliteTable(
  "product_release_image",
  {
    releaseId: text("release_id")
      .notNull()
      .references(() => productRelease.id, { onDelete: "cascade" }),
    /**
     * THE ASSET, which is also what `product_image` is keyed by — so a frozen
     * membership row survives its image losing its ordering row but not its
     * bytes losing their asset. That is the cascade the warning below describes.
     */
    imageId: text("image_id")
      .notNull()
      .references(() => productAsset.id, { onDelete: "cascade" }),
    alt: text("alt").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.imageId] }),
    /** The storefront reads one release's set in order; this is that scan. */
    index("idx_product_release_image_order").on(t.releaseId, t.position),
    check("product_release_image_position_non_negative", sql`position >= 0`),
  ],
);

/**
 * A purchasable variant: a size with its own SKU and stock. Live domain state,
 * deliberately OUTSIDE the release model — a release never mutates inventory
 * and inventory is never snapshotted.
 *
 * `stock_non_negative` makes negative stock unrepresentable. It is the backstop,
 * not the mechanism: the reservation guard
 * `UPDATE … SET stock = stock - qty WHERE id = ? AND stock >= qty`, read through
 * its `meta.changes`, is the actual concurrency control.
 */
export const productVariant = sqliteTable(
  "product_variant",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    size: text("size").notNull(),
    sku: text("sku").notNull().unique(),
    /**
     * UNITS THIS VARIANT MAY STILL SELL, and it means two different things
     * depending on {@link mode} — deliberately, because the arithmetic is
     * identical and duplicating it into a second counter is how the two drift.
     *
     *   stock    → physical units on a shelf. Selling one ships one.
     *   preorder → units of a manufacturing run that has not happened yet.
     *              The cap is a commitment, not an inventory count.
     *
     * Either way the reservation guard is the same conditional decrement, which
     * is what makes overselling a pre-order run as impossible as overselling a
     * shelf.
     */
    stock: integer("stock").notNull().default(0),
    mode: text("mode", { enum: VARIANT_MODES }).notNull().default("stock"),
    /**
     * When a buyer should expect this to ship. Only meaningful for `preorder`,
     * where the whole transaction is "pay now, receive later" and hiding the
     * date is how a pre-order becomes a complaint.
     */
    expectedShipAt: integer("expected_ship_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_variant_product").on(t.productId),
    uniqueIndex("idx_variant_product_size").on(t.productId, t.size),
    check("stock_non_negative", sql`stock >= 0`),
  ],
);

// ── Orders and fulfillment ───────────────────────────────────────────────────

/**
 * Named `customer_order` to dodge the `order` SQL keyword. One shipment per
 * order, so tracking lives on the order row, and `status` is the combined order
 * + fulfillment lifecycle — there is no separate fulfillment state machine.
 *
 * `order_number` is the human handle and the ONLY order identifier the RPC
 * surface exposes; `id` never appears in a DTO.
 *
 * The shipping columns are nullable because a hosted checkout collects the
 * address DURING payment, so the order row exists before the address does.
 * `ship_address_atomic` makes a HALF-written address unrepresentable.
 *
 * No deletion path ever writes this table.
 */
export const customerOrder = sqliteTable(
  "customer_order",
  {
    id: text("id").primaryKey(),
    orderNumber: text("order_number").notNull().unique(),
    userId: text("user_id").notNull(),
    /**
     * The address the order was PLACED with, and it never changes.
     *
     * It is the customer's lookup key, so overwriting it with whatever they
     * later typed on the payment page silently locks them out of their own
     * order. What the provider collected lives in {@link receiptEmail}.
     */
    email: text("email").notNull(),
    /** What the buyer gave the payment provider, if it differed. */
    receiptEmail: text("receipt_email"),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending"),
    shipName: text("ship_name"),
    shipLine1: text("ship_line1"),
    shipLine2: text("ship_line2"),
    shipCity: text("ship_city"),
    shipRegion: text("ship_region"),
    shipPostal: text("ship_postal"),
    shipCountry: text("ship_country").notNull().default("CA"),
    shipPhone: text("ship_phone"),
    /**
     * OURS, and known the moment the cart is priced. Line items times quantity
     * against the active release — the one number this system is the authority
     * for.
     */
    subtotalCents: integer("subtotal_cents").notNull(),
    /**
     * STRIPE'S, and zero until the payment settles.
     *
     * Tax is computed from the address the buyer types at checkout, and
     * shipping is whatever the provider reports — zero, since the price
     * contains it and no session carries a shipping line. Neither exists when
     * the order row is written. Guessing them here and hoping they match what was charged is how
     * a store's books diverge from its processor's; instead the settlement path
     * copies the amounts that were ACTUALLY charged out of the paid event.
     *
     * So before `paymentStatus` is `paid`, `totalCents` is not a total. Read
     * `subtotalCents` for an unpaid order, and read these for a paid one.
     */
    shippingCents: integer("shipping_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    /**
     * Minor units of WHAT. Stored per order rather than assumed globally,
     * because the one thing guaranteed about a currency constant is that it
     * stops being constant.
     */
    currency: text("currency").notNull().default("cad"),
    sessionId: text("session_id").unique(),
    /**
     * The charge behind this order, captured at settlement.
     *
     * Refunds and disputes arrive as Charge events, which carry a payment intent
     * and know nothing about our session — without this column there is no join
     * from "money went back" to "which order".
     */
    paymentIntentId: text("payment_intent_id"),
    /**
     * WHEN THIS ORDER'S STOCK WENT BACK, and the reason it is a column rather
     * than an inference.
     *
     * Three separate paths release an order — the reconcile sweep, a failing
     * checkout event, and a refund — and they do not coordinate. Worse, the
     * sweep CAUSES one of the others: it calls `expire` on the session, which
     * makes Stripe emit `checkout.session.expired`, which arrives with a fresh
     * event id and so is not a duplicate. Without a durable marker both paths
     * restore the same units and the store invents inventory it cannot ship.
     *
     * Set inside the same batch as the restore, and every restore is guarded on
     * it being null, so releasing twice is unrepresentable rather than merely
     * unlikely.
     */
    stockReleasedAt: integer("stock_released_at"),
    /**
     * Cumulative minor units refunded, copied from the provider.
     *
     * Absolute rather than incremented, because the provider reports a running
     * total on the charge — so re-applying the same event writes the same number
     * and a redelivery cannot inflate it.
     */
    refundedCents: integer("refunded_cents").notNull().default(0),
    /**
     * Mirrors the payment session's own expiry so the reconcile sweep can find
     * stale-attached reservations without an unbounded provider scan. Written
     * in the same commit that attaches the session — an order missing this copy
     * is invisible to the sweep.
     */
    sessionExpiresAt: integer("session_expires_at"),
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    fulfillmentNote: text("fulfillment_note"),
    shippedAt: integer("shipped_at"),
    deliveredAt: integer("delivered_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_order_user").on(t.userId, t.createdAt),
    index("idx_order_created").on(t.createdAt),
    /**
     * THE SWEEP'S OWN PREDICATE, composite and in its filter order.
     *
     * `sweep` selects `status = 'pending' AND payment_status = 'unpaid' AND
     * session_expires_at < ?`. An index on `status` alone is nearly useless
     * here — pending is not selective on a table that is mostly pending until it
     * is mostly paid — and this runs on a cron over the whole order book.
     */
    index("idx_order_sweep").on(t.status, t.paymentStatus, t.sessionExpiresAt),
    /**
     * THE REFUND JOIN. A charge event carries no session and no metadata, so
     * `settle` resolves it by payment intent — and without this that lookup is a
     * full scan of every order the store has ever taken, on the path where money
     * is going back.
     */
    index("idx_order_payment_intent").on(t.paymentIntentId),
    check(
      "ship_address_atomic",
      sql`(ship_name IS NULL) = (ship_line1 IS NULL) AND (ship_name IS NULL) = (ship_city IS NULL) AND (ship_name IS NULL) = (ship_region IS NULL) AND (ship_name IS NULL) = (ship_postal IS NULL)`,
    ),
  ],
);

/**
 * Line items that SNAPSHOT title, size, and unit price at purchase time, so
 * later catalog edits never rewrite a customer's order history.
 *
 * The absence of a catalog foreign key on `product_id` / `variant_id` is the
 * LOAD-BEARING design decision behind the deletion protocol: deleting a
 * product, release, or variant never cascades into order history and cannot be
 * blocked by it. The cost is that those columns become dangling references
 * after a catalog delete, which is exactly why every `plan*` call surfaces
 * retained order counts and warnings instead of refusing.
 */
export const orderItem = sqliteTable(
  "order_item",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => customerOrder.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    variantId: text("variant_id").notNull(),
    titleSnapshot: text("title_snapshot").notNull(),
    sizeSnapshot: text("size_snapshot").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    /**
     * SNAPSHOT of how this line was sold, beside the price snapshot and for the
     * same reason: the variant can be flipped from `preorder` to `stock` the day
     * the run lands, and that must not rewrite what a buyer was told when they
     * paid. Fulfilment reads this, not the variant.
     */
    preorder: integer("preorder", { mode: "boolean" }).notNull().default(false),
    expectedShipAt: integer("expected_ship_at"),
  },
  (t) => [index("idx_item_order").on(t.orderId)],
);

// ── Payment ledger ───────────────────────────────────────────────────────────

/**
 * One row per provider event the settlement consumer has seen. The provider's
 * event id is globally unique and is the only durable replay key trusted here.
 *
 * `outcome` carries `applied` | `ignored` | `dead`. A `dead` row is what
 * replaces v2's dead-letter queue: it is queryable, joins to orders, and
 * outlives any queue retention window. No operator method touches this table,
 * and no catalog delete may either.
 */
export const paymentEvent = sqliteTable(
  "payment_event",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    sessionId: text("session_id"),
    orderId: text("order_id"),
    outcome: text("outcome").notNull(),
    attempts: integer("attempts"),
    payload: text("payload"),
    createdAt: integer("created_at").notNull(),
  },
  /**
   * The order timeline reads this by order id, and this table is append-only and
   * never pruned — so without an index that read scans every provider event the
   * store has ever received, and gets slower every single day.
   */
  (t) => [index("idx_payment_event_order").on(t.orderId, t.createdAt)],
);

// ── Operator audit and deletion intents ──────────────────────────────────────

/**
 * THE COMMAND LEDGER: the idempotency record and the audit trail, one table
 * doing both jobs — which is why the design works.
 *
 * The idempotency half is the one you cannot remove. A phone that drops its
 * connection after the server reserved stock, but before the response arrived,
 * produces a second identical request; without a durable "already did this"
 * marker committed IN THE SAME BATCH as the work, that second request reserves
 * again. UNIQUE(idempotency_key, action) makes a replay a no-op and
 * `response_json` returns the ORIGINAL answer verbatim.
 *
 * The audit half is close to free once that row has to exist anyway — and it is
 * what answers a chargeback. The order row holds only the LATEST value of every
 * field, so a corrected tracking number erases the one that was emailed. This
 * keeps both.
 *
 * It is a COMMAND log, not a change log: it records what was asked and what was
 * answered, never before/after values, so state cannot be rebuilt from it.
 *
 * Exactly one row per successful mutation, inserted in the SAME batch as the
 * domain write, so audit and effect cannot diverge. Only successes are
 * recorded, therefore a present row always means a success replay and a failed
 * call is safely retryable. `detail_json` holds identifiers and COUNTS only —
 * never a body, blob, or secret.
 */
export const commandEvent = sqliteTable(
  "command_event",
  {
    id: text("id").primaryKey(),
    /**
     * WHO ISSUED THE COMMAND — an operator OR a customer.
     *
     * Named `actor` rather than `operator` because a guest checkout writes rows
     * here too: `placeOrder` runs through the same ledger with a subject of
     * `customer:<email>`. Calling the column `operator_email` while it holds
     * shoppers' addresses hides PII from anyone reasoning about the schema, and
     * would quietly scope a "purge this operator" job over customers.
     */
    actorSub: text("actor_sub").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    requestId: text("request_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    outcome: text("outcome").notNull(),
    detailJson: text("detail_json"),
    responseJson: text("response_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("command_event_idempotency_action_unique").on(t.idempotencyKey, t.action),
    /**
     * The other half of the order timeline. This is the fastest-growing table in
     * the store — one row per operator command, forever — and the timeline
     * filters it on `(target_type, target_id)`, which nothing else indexed.
     */
    index("idx_command_event_target").on(t.targetType, t.targetId, t.createdAt),
  ],
);

/**
 * The short-lived deletion plan. It stores ONLY a token hash and an impact hash
 * — never a dependency graph, and never the plaintext token, so a database read
 * cannot forge a confirmation.
 *
 * Three properties are load-bearing. `token_hash` as the primary key makes the
 * token the sole lookup path, so a subject's outstanding intents cannot be
 * enumerated. `target_id` holds the serialised SUBJECT, so the confirm call
 * needs no target argument and a token cannot be redirected at a different
 * aggregate. `consumed_at` is set INSIDE the deletion batch, so consumption and
 * effect are atomic.
 */
export const deletionIntent = sqliteTable("store_operator_deletion_intent", {
  tokenHash: text("token_hash").primaryKey(),
  operatorSub: text("operator_sub").notNull(),
  action: text("action").notNull(),
  targetId: text("target_id").notNull(),
  impactHash: text("impact_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
});

/**
 * THE FAKE PROVIDER'S TABLE IS DELIBERATELY ABSENT, and this note is here so
 * nobody re-adds it.
 *
 * The spike re-exported `fakeSession` from here so drizzle-kit would pick it up.
 * That put `CREATE TABLE fake_session` in the one linear migration set, which is
 * applied to EVERY database at EVERY stage — so production carried an empty
 * table belonging to a test double, forever, that nothing could ever write to.
 * `PaymentsProvider.resolve` dies on `preprod` and `prod` before the fake is
 * ever constructed, so the table was unreachable by the only code that knows
 * what it is for.
 *
 * The fake now lives under `tests/services/PaymentsFake.ts` and creates its own
 * table at the moment it is built. Nothing `module.ts` deploys can import it, so
 * nothing deployed can carry its table — the gate is the module boundary rather
 * than a branch someone has to keep correct.
 *
 * Everything below is domain. If a table here has no domain meaning, it is in
 * the wrong file.
 */
