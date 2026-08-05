/**
 * The product lifecycle: draft → release → active release.
 *
 * A PLAIN FUNCTION module. Nothing here is a service and nothing reads a tag —
 * every function takes the handle it needs as an argument. Tags buy
 * swappability, and a domain core is never swapped, so it pays no ceremony.
 * The payoff is that this whole file is drivable against a local database with
 * no Worker runtime in sight.
 *
 * Two rules the release model enforces:
 *
 *  - THE DRAFT IS NEVER PUBLIC. Every storefront and checkout read sources
 *    title and price from the product's ACTIVE RELEASE. The draft is operator
 *    state; publishing is what makes an edit visible.
 *  - A RELEASE IS IMMUTABLE WHILE RETAINED. It may be deleted, never edited,
 *    which is what makes UNIQUE(product_id, version) a real constraint.
 *
 * Every mutating function returns a {@link CoreOutcome}: the statements it wants
 * committed plus the response to record, or a typed domain failure. It never
 * writes — `Audit.command` commits, so the mutation and its audit row cannot
 * diverge.
 */
import { and, asc, count, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { query, type ClassicDb, type DbStatement } from "../services/Database.ts";
import type { CoreOutcome } from "../services/Audit.ts";
import {
  err,
  isValidVersion,
  nextVersion,
  mediaHref,
  ok,
  type CreateProductInput,
  type ListProductsInput,
  type ProductDetail,
  type ProductDraftDTO,
  type ProductListPage,
  type ProductMediaDTO,
  type ProductMediaRole,
  type ProductStatus,
  type ProductVariantDTO,
  type PublishProductInput,
  type PutVariantInput,
  type ReorderProductMediaInput,
  type SaveProductDraftInput,
  type AdjustStockInput,
} from "./Contracts.ts";
import { isAvailable } from "../core/availability.ts";
import { isNonNegativeInt, sortBySize } from "../core/money.ts";
import { pageWindow, splitPage } from "../core/paging.ts";
import {
  draftMarket,
  product,
  productDraft,
  productImage,
  productRelease,
  productReleaseImage,
  productVariant,
  releaseMarket,
} from "./Schema.ts";

// ── Reads ────────────────────────────────────────────────────────────────────

const toDraftDTO = (row: {
  productId: string;
  slug: string;
  revision: number;
  title: string;
  descriptionMarkdown: string | null;
  status: string;
  activeVersion: string | null;
  updatedAt: number;
}): ProductDraftDTO => ({
  productId: row.productId,
  slug: row.slug,
  revision: row.revision,
  title: row.title,
  descriptionMarkdown: row.descriptionMarkdown,
  status: row.status as ProductStatus,
  activeVersion: row.activeVersion,
  updatedAt: row.updatedAt,
});

/**
 * The operator product list, keyset-paged over `(updated_at DESC, id DESC)`.
 *
 * The cursor predicate is the standard two-column comparison: strictly older, or
 * the same instant with a strictly smaller id. Without the id tiebreak, several
 * products sharing an `updated_at` would be skipped or repeated at a page seam.
 */
/**
 * The draft projection, selected identically by the list and the detail read.
 *
 * ONE DEFINITION because both reads feed the same `toDraftDTO`, so they have to
 * agree on what a draft IS. Held apart, a column added to one and not the other
 * gives a list and a detail view that disagree about the same product — and the
 * mapper would still typecheck against whichever it was written for.
 *
 * `getProduct` widens this with the pre-order run; it does not restate it.
 */
const draftColumns = {
  productId: product.id,
  slug: product.slug,
  status: product.status,
  updatedAt: product.updatedAt,
  activeVersion: productRelease.version,
  revision: productDraft.revision,
  title: productDraft.title,
  descriptionMarkdown: productDraft.descriptionMarkdown,
};

/**
 * Does this product have any size sold against a run?
 *
 * THE PREDICATE BEHIND `preorder_cap_missing`, named once because three
 * separate doors lead to the same unbuyable state — `publishProduct` and
 * `setProductStatus` on the way in, `setPreorderCap` clearing the cap out from
 * under a live product. Three copies of a security-shaped check is three places
 * for one of them to drift.
 */
const hasPreorderVariant = Effect.fn("Catalog.hasPreorderVariant")(function* (
  db: ClassicDb,
  productId: string,
) {
  const rows = yield* query(() =>
    db
      .select({ id: productVariant.id })
      .from(productVariant)
      .where(and(eq(productVariant.productId, productId), eq(productVariant.mode, "preorder")))
      .limit(1),
  );
  return rows[0] !== undefined;
});

export const listProducts = Effect.fn("Catalog.listProducts")(function* (
  db: ClassicDb,
  input: ListProductsInput,
): Effect.fn.Return<CoreOutcome<ProductListPage, "invalid_cursor">> {
  const window = pageWindow(input);
  if (!window.ok) return { failure: err("invalid_cursor") };
  const { limit, after } = window.value;

  const filters = [
    input.status && input.status !== "all" ? eq(product.status, input.status) : undefined,
    after
      ? or(
          lt(product.updatedAt, after.at),
          and(eq(product.updatedAt, after.at), lt(product.id, after.id)),
        )
      : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = yield* query(() =>
    db
      .select(draftColumns)
      .from(product)
      .innerJoin(productDraft, eq(productDraft.productId, product.id))
      .leftJoin(productRelease, eq(productRelease.id, product.activeReleaseId))
      // Over-fetch by one: the extra row is how "is there a next page" is known
      // without a second COUNT query.
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(product.updatedAt), desc(product.id))
      .limit(limit + 1),
  );

  const { page, nextCursor } = splitPage(rows, limit, (row) => ({
    at: row.updatedAt,
    id: row.productId,
  }));

  return {
    statements: [],
    response: ok({ products: page.map(toDraftDTO), nextCursor }),
    facts: { targetType: "product", targetId: "list" },
  };
});

export const getProduct = Effect.fn("Catalog.getProduct")(function* (
  db: ClassicDb,
  productId: string,
): Effect.fn.Return<CoreOutcome<ProductDetail, "not_found">> {
  const rows = yield* query(() =>
    db
      .select({
        ...draftColumns,
        preorderCap: product.preorderCap,
        preorderClaimed: product.preorderClaimed,
      })
      .from(product)
      .innerJoin(productDraft, eq(productDraft.productId, product.id))
      .leftJoin(productRelease, eq(productRelease.id, product.activeReleaseId))
      .where(eq(product.id, productId))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return { failure: err("not_found") };

  /** Ordered by code so CA and US land in a stable order for the editor. */
  const markets = yield* query(() =>
    db
      .select({
        market: draftMarket.market,
        priceCents: draftMarket.priceCents,
        active: draftMarket.active,
      })
      .from(draftMarket)
      .where(eq(draftMarket.productId, productId))
      .orderBy(asc(draftMarket.market)),
  );

  const releases = yield* query(() =>
    db
      .select({
        id: productRelease.id,
        version: productRelease.version,
        publishedAt: productRelease.publishedAt,
      })
      .from(productRelease)
      .where(eq(productRelease.productId, productId))
      .orderBy(desc(productRelease.publishedAt)),
  );

  const variants = yield* query(() =>
    db
      .select({
        id: productVariant.id,
        size: productVariant.size,
        sku: productVariant.sku,
        stock: productVariant.stock,
        mode: productVariant.mode,
        expectedShipAt: productVariant.expectedShipAt,
      })
      .from(productVariant)
      .where(eq(productVariant.productId, productId)),
  );

  const media = yield* query(() =>
    db
      .select()
      .from(productImage)
      .where(eq(productImage.productId, productId))
      .orderBy(asc(productImage.position)),
  );

  return {
    statements: [],
    response: ok({
      draft: toDraftDTO(row),
      markets: markets.map((entry) => ({
        market: entry.market as "CA" | "US",
        priceCents: entry.priceCents,
        active: entry.active,
      })),
      preorder: {
        cap: row.preorderCap,
        claimed: row.preorderClaimed,
        remaining: row.preorderCap === null ? null : row.preorderCap - row.preorderClaimed,
      },
      releases,
      // `available` is DERIVED, never stored — a stored copy is a second thing
      // that can disagree with the number it summarises. Derived from BOTH
      // counters via `core/availability.ts`, so the operator's view of what is
      // buyable and the shopper's are the same function rather than two
      // `stock > 0` checks that drifted apart.
      variants: sortBySize(variants).map(
        (variant): ProductVariantDTO => ({
          ...variant,
          available: isAvailable({
            stock: variant.stock,
            mode: variant.mode,
            runCap: row.preorderCap,
            runClaimed: row.preorderClaimed,
          }),
        }),
      ),
      media: media.map(
        (image): ProductMediaDTO => ({
          id: image.id,
          productId: image.productId,
          alt: image.alt,
          role: image.role as ProductMediaRole,
          position: image.position,
          href: mediaHref(image.id),
          contentType: image.contentType,
          size: image.sizeBytes,
          sha256: image.contentSha256,
        }),
      ),
    }),
    facts: { targetType: "product", targetId: productId },
  };
});

// ── Product lifecycle ────────────────────────────────────────────────────────

const slugTaken = Effect.fn("Catalog.slugTaken")(function* (
  db: ClassicDb,
  slug: string,
  exceptProductId?: string,
) {
  const rows = yield* query(() =>
    db
      .select({ id: product.id })
      .from(product)
      .where(
        exceptProductId
          ? and(eq(product.slug, slug), ne(product.id, exceptProductId))
          : eq(product.slug, slug),
      )
      .limit(1),
  );
  return rows.length > 0;
});

export const createProduct = Effect.fn("Catalog.createProduct")(function* (
  db: ClassicDb,
  input: CreateProductInput,
  actorSub: string,
  now: number,
  productId: string,
): Effect.fn.Return<CoreOutcome<{ productId: string; revision: 1 }, "slug_taken">> {
  if (yield* slugTaken(db, input.slug)) return { failure: err("slug_taken") };

  return {
    statements: [
      db.insert(product).values({
        id: productId,
        slug: input.slug,
        status: "draft",
        activeReleaseId: null,
        createdBySub: actorSub,
        createdAt: now,
        updatedAt: now,
      }) as unknown as DbStatement,
      db.insert(productDraft).values({
        productId,
        revision: 1,
        title: input.title,
        descriptionMarkdown: input.descriptionMarkdown ?? null,
        updatedBySub: actorSub,
        updatedAt: now,
      }) as unknown as DbStatement,
    ],
    response: ok({ productId, revision: 1 as const }),
    facts: { targetType: "product", targetId: productId, detail: { slug: input.slug } },
  };
});

/**
 * Save the draft under optimistic concurrency.
 *
 * `expectedRevision` is the whole mechanism: the UPDATE is guarded on it, so two
 * operators editing the same product cannot silently overwrite each other. The
 * pre-read exists to tell `not_found` from `revision_conflict` — the guarded
 * write alone cannot distinguish them.
 */
export const saveProductDraft = Effect.fn("Catalog.saveProductDraft")(function* (
  db: ClassicDb,
  input: SaveProductDraftInput,
  actorSub: string,
  now: number,
): Effect.fn.Return<
  CoreOutcome<
    { revision: number; updatedAt: number },
    "not_found" | "revision_conflict" | "slug_taken" | "invalid_price"
  >
> {
  for (const entry of input.markets ?? []) {
    if (!isNonNegativeInt(entry.priceCents)) return { failure: err("invalid_price") };
  }

  const rows = yield* query(() =>
    db
      .select({ revision: productDraft.revision })
      .from(productDraft)
      .where(eq(productDraft.productId, input.productId))
      .limit(1),
  );
  const current = rows[0];
  if (!current) return { failure: err("not_found") };
  if (current.revision !== input.expectedRevision) return { failure: err("revision_conflict") };

  if (input.slug !== undefined && (yield* slugTaken(db, input.slug, input.productId))) {
    return { failure: err("slug_taken") };
  }

  const revision = current.revision + 1;
  const draftPatch: Record<string, unknown> = {
    revision,
    updatedBySub: actorSub,
    updatedAt: now,
  };
  if (input.title !== undefined) draftPatch.title = input.title;
  if (input.descriptionMarkdown !== undefined) {
    draftPatch.descriptionMarkdown = input.descriptionMarkdown;
  }

  const statements: DbStatement[] = [
    db
      .update(productDraft)
      .set(draftPatch)
      // Guarded on the revision as well as the id: the pre-read above is
      // advisory, this is the actual concurrency control.
      .where(
        and(
          eq(productDraft.productId, input.productId),
          eq(productDraft.revision, input.expectedRevision),
        ),
      ) as unknown as DbStatement,
    db
      .update(product)
      .set({ updatedAt: now })
      .where(eq(product.id, input.productId)) as unknown as DbStatement,
  ];
  if (input.slug !== undefined) {
    statements.push(
      db
        .update(product)
        .set({ slug: input.slug })
        .where(eq(product.id, input.productId)) as unknown as DbStatement,
    );
  }

  /**
   * The market rows ride the same batch as the revision-guarded draft update,
   * so a lost revision race rolls them back with everything else. UPSERT per
   * (product, market): omitted markets are untouched, and there is no delete —
   * `active: false` is "stop selling" with the price kept.
   */
  for (const entry of input.markets ?? []) {
    statements.push(
      db
        .insert(draftMarket)
        .values({
          productId: input.productId,
          market: entry.market,
          priceCents: entry.priceCents,
          active: entry.active,
        })
        .onConflictDoUpdate({
          target: [draftMarket.productId, draftMarket.market],
          set: { priceCents: entry.priceCents, active: entry.active },
        }) as unknown as DbStatement,
    );
  }

  return {
    statements,
    response: ok({ revision, updatedAt: now }),
    facts: { targetType: "product", targetId: input.productId, detail: { revision } },
  };
});

/**
 * Freeze the draft into an immutable release and make it live.
 *
 * The two gates are not bureaucracy: a product with no media renders as a blank
 * card on the storefront, and a product with no variant has nothing purchasable,
 * so publishing either would put a broken listing in front of a customer.
 *
 * The release copies the image set into `product_release_image`, so later media
 * edits never rewrite a published snapshot.
 */
export const publishProduct = Effect.fn("Catalog.publishProduct")(function* (
  db: ClassicDb,
  input: PublishProductInput,
  actorSub: string,
  now: number,
  releaseId: string,
): Effect.fn.Return<
  CoreOutcome<
    { releaseId: string; version: string; publishedAt: number },
    | "not_found"
    | "revision_conflict"
    | "invalid_version"
    | "version_exists"
    | "missing_media"
    | "missing_variant"
    | "missing_market"
    | "preorder_cap_missing"
  >
> {
  const rows = yield* query(() =>
    db
      .select({
        slug: product.slug,
        revision: productDraft.revision,
        title: productDraft.title,
        descriptionMarkdown: productDraft.descriptionMarkdown,
      })
      .from(product)
      .innerJoin(productDraft, eq(productDraft.productId, product.id))
      .where(eq(product.id, input.productId))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return { failure: err("not_found") };
  if (row.revision !== input.expectedRevision) return { failure: err("revision_conflict") };

  /**
   * DERIVED unless the operator insists on a name.
   *
   * The version is a label for humans to point at, so making it a required input
   * turned every typo fix into "what number is this". Publishing without one is
   * the normal path; supplying one is for the rare release you want to call
   * something specific, and only then can it be rejected.
   */
  const existing = yield* query(() =>
    db
      .select({ version: productRelease.version })
      .from(productRelease)
      .where(eq(productRelease.productId, input.productId)),
  );

  if (input.version !== undefined && !isValidVersion(input.version)) {
    return { failure: err("invalid_version") };
  }
  const version =
    input.version ??
    nextVersion(
      existing.map((release) => release.version),
      input.bump,
    );

  // UNIQUE(product_id, version) still holds, so a name that is already taken is
  // refused rather than aborting the batch on a constraint violation.
  if (existing.some((release) => release.version === version)) {
    return { failure: err("version_exists") };
  }

  const images = yield* query(() =>
    db
      .select({
        id: productImage.id,
        alt: productImage.alt,
        role: productImage.role,
        position: productImage.position,
      })
      .from(productImage)
      .where(eq(productImage.productId, input.productId))
      .orderBy(asc(productImage.position)),
  );
  if (images.length === 0) return { failure: err("missing_media") };

  const variants = yield* query(() =>
    db
      .select({ total: count() })
      .from(productVariant)
      .where(eq(productVariant.productId, input.productId)),
  );
  if ((variants[0]?.total ?? 0) === 0) return { failure: err("missing_variant") };

  /**
   * A release with no market rows would be on sale nowhere, in no currency —
   * every storefront hides it and every checkout refuses it, while the console
   * reads "published". Priced-but-paused rows pass: all-inactive is a
   * deliberate state an operator flipped, not a forgotten editor.
   */
  const draftMarkets = yield* query(() =>
    db
      .select({
        market: draftMarket.market,
        priceCents: draftMarket.priceCents,
        active: draftMarket.active,
      })
      .from(draftMarket)
      .where(eq(draftMarket.productId, input.productId)),
  );
  if (draftMarkets.length === 0) return { failure: err("missing_market") };

  /**
   * PUBLISH IS THE DOOR TO `active` — the statement below writes the status
   * itself — so this gate has to be here and not only on `setProductStatus`.
   * Guarding one of two doors is not guarding.
   *
   * A pre-order variant with no run cap makes `runGuardStatement` match zero
   * rows on every claim, so the product goes live looking entirely normal and
   * refuses every buyer with `preorder_full`, permanently. Set the cap first;
   * `setPreorderCap` works on a draft.
   */
  const runless = yield* query(() =>
    db
      .select({ id: productVariant.id })
      .from(productVariant)
      .innerJoin(product, eq(product.id, productVariant.productId))
      .where(
        and(
          eq(productVariant.productId, input.productId),
          eq(productVariant.mode, "preorder"),
          isNull(product.preorderCap),
        ),
      )
      .limit(1),
  );
  if (runless[0]) return { failure: err("preorder_cap_missing") };

  return {
    statements: [
      db.insert(productRelease).values({
        id: releaseId,
        productId: input.productId,
        version,
        slug: row.slug,
        title: row.title,
        descriptionMarkdown: row.descriptionMarkdown,
        publishedBySub: actorSub,
        publishedAt: now,
      }) as unknown as DbStatement,
      /**
       * The market set is FROZEN with the release, exactly like the image set:
       * a later draft edit must never rewrite what a published release charges.
       */
      ...draftMarkets.map(
        (entry) =>
          db.insert(releaseMarket).values({
            releaseId,
            market: entry.market,
            priceCents: entry.priceCents,
            active: entry.active,
          }) as unknown as DbStatement,
      ),
      ...images.map(
        (image) =>
          db.insert(productReleaseImage).values({
            releaseId,
            imageId: image.id,
            alt: image.alt,
            role: image.role,
            position: image.position,
          }) as unknown as DbStatement,
      ),
      db
        .update(product)
        .set({ activeReleaseId: releaseId, status: "active", updatedAt: now })
        .where(eq(product.id, input.productId)) as unknown as DbStatement,
    ],
    response: ok({ releaseId, version, publishedAt: now }),
    facts: {
      targetType: "product",
      targetId: input.productId,
      detail: { version, imageCount: images.length },
    },
  };
});

/**
 * Set the lifecycle status directly.
 *
 * `active` and `unavailable` are published-lifecycle states and both require a
 * live release — `unavailable` means a published product pulled from sale, not
 * an unpublished one. `draft` and `archived` require none.
 *
 * GOING ACTIVE ALSO REQUIRES THAT THE PRODUCT CAN ACTUALLY BE BOUGHT, which was
 * previously nobody's job — see `preorder_cap_missing` below.
 */
export const setProductStatus = Effect.fn("Catalog.setProductStatus")(function* (
  db: ClassicDb,
  productId: string,
  status: ProductStatus,
  now: number,
): Effect.fn.Return<
  CoreOutcome<{ status: ProductStatus }, "not_found" | "no_release" | "preorder_cap_missing">
> {
  const rows = yield* query(() =>
    db
      .select({
        id: product.id,
        activeReleaseId: product.activeReleaseId,
        preorderCap: product.preorderCap,
      })
      .from(product)
      .where(eq(product.id, productId))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return { failure: err("not_found") };
  if ((status === "active" || status === "unavailable") && row.activeReleaseId === null) {
    return { failure: err("no_release") };
  }

  /**
   * THE BRICK, REFUSED AT THE ONLY DOOR IT COMES THROUGH.
   *
   * `runGuardStatement` requires `preorder_cap IS NOT NULL`, so a pre-order
   * variant under a product with no cap matches zero rows on every claim and
   * EVERY checkout fails with `preorder_full`, forever. Nothing used to
   * validate the pairing — not `putVariant`, not `publishProduct`, not the
   * console — so the product went live looking perfectly normal and refused
   * every buyer.
   *
   * Checked only on the way to `active`, because that is the transition that
   * exposes it to shoppers. A draft in this shape is a work in progress; a live
   * one is a shop that takes no money.
   */
  if (
    status === "active" &&
    row.preorderCap === null &&
    (yield* hasPreorderVariant(db, productId))
  ) {
    return { failure: err("preorder_cap_missing") };
  }

  return {
    statements: [
      db
        .update(product)
        .set({ status, updatedAt: now })
        .where(eq(product.id, productId)) as unknown as DbStatement,
    ],
    response: ok({ status }),
    facts: { targetType: "product", targetId: productId, detail: { status } },
  };
});

// ── Variants and inventory ───────────────────────────────────────────────────

/**
 * Create or update a variant. `variantId` absent means create.
 *
 * SKU is unique globally; size is unique per product. Both are checked here so
 * the caller gets `sku_taken` / `size_taken` rather than a UNIQUE violation
 * surfacing as a defect.
 */
/**
 * Does this size or SKU already belong to a DIFFERENT row?
 *
 * Checked here rather than left to the unique indexes so the caller gets
 * `sku_taken` / `size_taken` instead of a constraint violation surfacing as a
 * defect — a violation is a statement ERROR, which aborts the whole audited
 * batch and answers 500.
 *
 * `ne(id, variantId)` is what lets an update keep its own size and SKU: on a
 * create `variantId` is a fresh id that matches nothing, so the same predicate
 * serves both paths.
 */
const variantClash = Effect.fn("Catalog.variantClash")(function* (
  db: ClassicDb,
  productId: string,
  sku: string,
  size: string,
  variantId: string,
): Effect.fn.Return<"sku_taken" | "size_taken" | null> {
  const skuClash = yield* query(() =>
    db
      .select({ id: productVariant.id })
      .from(productVariant)
      .where(and(eq(productVariant.sku, sku), ne(productVariant.id, variantId)))
      .limit(1),
  );
  if (skuClash[0]) return "sku_taken";

  const sizeClash = yield* query(() =>
    db
      .select({ id: productVariant.id })
      .from(productVariant)
      .where(
        and(
          eq(productVariant.productId, productId),
          eq(productVariant.size, size),
          ne(productVariant.id, variantId),
        ),
      )
      .limit(1),
  );
  return sizeClash[0] ? "size_taken" : null;
});

/**
 * The row write, and the asymmetry between creating and updating is the whole
 * reason this is its own function.
 *
 * ON CREATE every field is written, defaulted where the caller said nothing.
 * ON UPDATE the three optional fields are written ONLY IF NAMED, because an
 * omitted field means "leave it" rather than "reset it":
 *
 *   mode            a stock adjustment that omitted it would flip every
 *                   pre-order page into an in-stock page.
 *   expectedShipAt  likewise erases what a buyer was promised.
 *   stock           worst of the three. This is an ABSOLUTE write with no
 *                   guard, computed from whatever the caller read before they
 *                   started typing — so a rename carrying a stale count rolls
 *                   inventory back over every checkout that landed in between.
 *                   `stock = 12` cannot lose to a concurrent sale the way
 *                   `stock = stock - 1 WHERE stock >= 1` can. `adjustStock` is
 *                   the guarded relative path, and is what the console uses;
 *                   naming `stock` here is for correcting a count on a product
 *                   that is not selling.
 */
const variantStatement = (
  db: ClassicDb,
  input: PutVariantInput,
  variantId: string,
  updating: boolean,
  now: number,
): DbStatement =>
  updating
    ? (db
        .update(productVariant)
        .set({
          size: input.size,
          sku: input.sku,
          ...(input.stock !== undefined ? { stock: input.stock } : {}),
          ...(input.mode !== undefined ? { mode: input.mode } : {}),
          ...(input.expectedShipAt !== undefined ? { expectedShipAt: input.expectedShipAt } : {}),
        })
        .where(eq(productVariant.id, variantId)) as unknown as DbStatement)
    : (db.insert(productVariant).values({
        id: variantId,
        productId: input.productId,
        size: input.size,
        sku: input.sku,
        /** A variant nobody gave units to has none, rather than defaulting to some. */
        stock: input.stock ?? 0,
        mode: input.mode ?? "stock",
        expectedShipAt: input.expectedShipAt ?? null,
        createdAt: now,
      }) as unknown as DbStatement);

export const putVariant = Effect.fn("Catalog.putVariant")(function* (
  db: ClassicDb,
  input: PutVariantInput,
  now: number,
  newVariantId: string,
): Effect.fn.Return<
  CoreOutcome<{ variantId: string }, "not_found" | "sku_taken" | "size_taken" | "invalid_stock">
> {
  if (input.stock !== undefined && !isNonNegativeInt(input.stock)) {
    return { failure: err("invalid_stock") };
  }

  const owner = yield* query(() =>
    db.select({ id: product.id }).from(product).where(eq(product.id, input.productId)).limit(1),
  );
  if (!owner[0]) return { failure: err("not_found") };

  // Hoisted so the narrowing survives into the query closure below.
  const updating = input.variantId;
  const variantId = updating ?? newVariantId;

  if (updating !== undefined) {
    const existing = yield* query(() =>
      db
        .select({ id: productVariant.id })
        .from(productVariant)
        .where(and(eq(productVariant.id, updating), eq(productVariant.productId, input.productId)))
        .limit(1),
    );
    if (!existing[0]) return { failure: err("not_found") };
  }

  const clash = yield* variantClash(db, input.productId, input.sku, input.size, variantId);
  if (clash) return { failure: err(clash) };

  return {
    statements: [
      variantStatement(db, input, variantId, updating !== undefined, now),
      db
        .update(product)
        .set({ updatedAt: now })
        .where(eq(product.id, input.productId)) as unknown as DbStatement,
    ],
    response: ok({ variantId }),
    facts: { targetType: "variant", targetId: variantId, detail: { sku: input.sku } },
  };
});

/**
 * Open, resize or close a product's PRE-ORDER RUN.
 *
 * `null` closes it: the guard tests `preorder_cap IS NOT NULL`, so a closed run
 * refuses every claim without touching a single variant. That is how a run ends
 * when the garments are made — you set the cap to null and flip the variants to
 * `stock` with real counts.
 *
 * SHRINKING BELOW WHAT IS ALREADY SOLD IS REFUSED. Those places are paid for;
 * lowering the cap under them would leave the CHECK constraint violated and,
 * worse, would mean promising fewer shirts than people bought.
 */
export const setPreorderCap = Effect.fn("Catalog.setPreorderCap")(function* (
  db: ClassicDb,
  input: { productId: string; cap: number | null },
  now: number,
): Effect.fn.Return<
  CoreOutcome<
    { cap: number | null; claimed: number; remaining: number | null },
    "not_found" | "invalid_cap" | "cap_below_claimed" | "preorder_cap_missing"
  >
> {
  if (input.cap !== null && !isNonNegativeInt(input.cap)) {
    return { failure: err("invalid_cap") };
  }

  const rows = yield* query(() =>
    db
      .select({ claimed: product.preorderClaimed, status: product.status })
      .from(product)
      .where(eq(product.id, input.productId))
      .limit(1),
  );
  const current = rows[0];
  if (!current) return { failure: err("not_found") };

  if (input.cap !== null && input.cap < current.claimed) {
    return {
      failure: err("cap_below_claimed", `${current.claimed} already sold`),
    };
  }

  /**
   * THE OTHER DOOR TO THE SAME BRICK, and it is the one an operator is more
   * likely to walk through: clearing the cap on a product that is ON SALE with
   * pre-order variants leaves the run guard with nothing to match, so every
   * checkout begins failing `preorder_full` immediately and silently.
   *
   * `setProductStatus` refuses the same shape on the way in. Refusing it here
   * too is what makes the state unreachable rather than merely inconvenient to
   * reach — a guard on one of two doors is not a guard.
   *
   * Only for an ACTIVE product. Clearing the cap on a draft is how you convert
   * a run back into shelf stock, and the variants are flipped to `stock` in the
   * same sitting.
   */
  if (
    input.cap === null &&
    current.status === "active" &&
    (yield* hasPreorderVariant(db, input.productId))
  ) {
    return { failure: err("preorder_cap_missing") };
  }

  return {
    statements: [
      db
        .update(product)
        .set({ preorderCap: input.cap, updatedAt: now })
        .where(
          /**
           * THE SAME PREDICATE THE READ ABOVE ONLY ADVISED.
           *
           * `claimed` was read in a separate query, so a checkout landing in
           * between could push `preorder_claimed` past the new cap. An
           * unguarded UPDATE then violated `preorder_claimed_within_cap` — and
           * a constraint violation is a statement ERROR, so it aborted the
           * whole audited batch and surfaced as a 500 instead of the
           * `cap_below_claimed` this function exists to return.
           *
           * Pushing the predicate into SQL turns that into a zero-row update,
           * which `guards` below reads and reports properly.
           */
          sql`${product.id} = ${input.productId} and (${input.cap} is null or ${product.preorderClaimed} <= ${input.cap})`,
        ) as unknown as DbStatement,
    ],
    guards: [{ index: 0, error: "cap_below_claimed" as const }],
    response: ok({
      cap: input.cap,
      claimed: current.claimed,
      remaining: input.cap === null ? null : input.cap - current.claimed,
    }),
    facts: {
      targetType: "product",
      targetId: input.productId,
      detail: { cap: input.cap, claimed: current.claimed },
    },
  };
});

/**
 * Move stock by a signed delta.
 *
 * The read-then-check is ADVISORY; the write is a guarded relative update, so a
 * concurrent adjustment cannot drive stock negative between the two. A guard
 * that matches nothing means the delta would have gone below zero, and
 * `guards` is what makes that a `negative_stock` refusal rather than a
 * silently-recorded success.
 */
export const adjustStock = Effect.fn("Catalog.adjustStock")(function* (
  db: ClassicDb,
  input: AdjustStockInput,
): Effect.fn.Return<CoreOutcome<{ stock: number }, "not_found" | "negative_stock">> {
  const rows = yield* query(() =>
    db
      .select({ stock: productVariant.stock, productId: productVariant.productId })
      .from(productVariant)
      .where(eq(productVariant.id, input.variantId))
      .limit(1),
  );
  const current = rows[0];
  if (!current) return { failure: err("not_found") };

  const next = current.stock + input.delta;
  if (next < 0) return { failure: err("negative_stock") };

  return {
    statements: [
      db
        .update(productVariant)
        .set({ stock: sql`${productVariant.stock} + ${input.delta}` })
        .where(
          and(
            eq(productVariant.id, input.variantId),
            sql`${productVariant.stock} + ${input.delta} >= 0`,
          ),
        ) as unknown as DbStatement,
    ],
    /**
     * THE READ ABOVE IS ADVISORY; THIS IS WHAT DECIDES.
     *
     * `next` is computed from a SELECT that is already stale by the time the
     * batch runs, so a concurrent checkout can take the units this delta was
     * counting on. The WHERE clause is what actually stops stock going negative
     * — and a WHERE that matches nothing is a no-op, not an error, so without
     * declaring it here the command reported success for a write that never
     * happened AND recorded that fiction in the ledger for a later replay to
     * serve back.
     */
    guards: [{ index: 0, error: "negative_stock" as const }],
    response: ok({ stock: next }),
    facts: {
      targetType: "variant",
      targetId: input.variantId,
      detail: { delta: input.delta, reason: input.reason },
    },
  };
});

/**
 * Reorder a product's media.
 *
 * The supplied list must be the EXACT set of the product's media ids — same
 * members, no duplicates. A partial list would silently leave the omitted
 * images at stale positions, which reads as data loss to an operator.
 */
export const reorderProductMedia = Effect.fn("Catalog.reorderProductMedia")(function* (
  db: ClassicDb,
  input: ReorderProductMediaInput,
  now: number,
): Effect.fn.Return<CoreOutcome<{ ok: true }, "not_found" | "invalid_order">> {
  const images = yield* query(() =>
    db
      .select({ id: productImage.id })
      .from(productImage)
      .where(eq(productImage.productId, input.productId)),
  );
  if (images.length === 0) return { failure: err("not_found") };

  const owned = new Set(images.map((image) => image.id));
  const supplied = new Set(input.mediaIds);
  if (
    supplied.size !== input.mediaIds.length ||
    supplied.size !== owned.size ||
    input.mediaIds.some((id) => !owned.has(id))
  ) {
    return { failure: err("invalid_order") };
  }

  return {
    statements: [
      ...input.mediaIds.map(
        (id, index) =>
          db
            .update(productImage)
            .set({ position: index })
            .where(eq(productImage.id, id)) as unknown as DbStatement,
      ),
      db
        .update(product)
        .set({ updatedAt: now })
        .where(eq(product.id, input.productId)) as unknown as DbStatement,
    ],
    response: ok({ ok: true as const }),
    facts: {
      targetType: "product",
      targetId: input.productId,
      detail: { count: input.mediaIds.length },
    },
  };
});
