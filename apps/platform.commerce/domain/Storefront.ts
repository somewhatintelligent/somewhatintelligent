/**
 * The public catalog: what a shopper sees.
 *
 * ONE RULE GOVERNS THIS ENTIRE FILE — every read joins through
 * `product.active_release_id` and sources title, price and description from the
 * RELEASE, never from `product_draft`. An operator editing a draft changes
 * nothing here until they publish, which is the whole reason the release model
 * exists.
 *
 * A product with no active release contributes NO row. That is the same
 * fail-closed rule checkout applies when it prices a cart, so the storefront
 * cannot advertise something checkout would refuse to sell.
 *
 * Media comes from `product_release_image` — the set FROZEN at publish time —
 * so deleting or reordering an image today never rewrites what a published
 * release shows.
 */
import { and, asc, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { query, type ClassicDb } from "../services/Database.ts";
import { mediaHref, type ProductCardDTO, type StorefrontProductDTO } from "./Contracts.ts";
import { isAvailable } from "../core/availability.ts";
import { MARKETS, type MarketCode } from "../core/markets.ts";
import { sortBySize } from "../core/money.ts";
import {
  product,
  productRelease,
  productReleaseImage,
  productVariant,
  releaseMarket,
} from "./Schema.ts";

/**
 * The storefront list FOR ONE MARKET. `active` only — `unavailable` is a
 * published product pulled from sale and must not appear, which is precisely
 * the distinction the four-value status domain exists to carry.
 *
 * The market row is INNER-joined: a release with no live row for this market
 * is simply not in this market's shop. The same rule checkout applies when it
 * prices the cart, so the list cannot advertise something checkout would
 * refuse with `market_unavailable`.
 */
export const listActiveProducts = Effect.fn("Storefront.listActiveProducts")(function* (
  db: ClassicDb,
  market: MarketCode,
) {
  const rows = yield* query(() =>
    db
      .select({
        productId: product.id,
        slug: productRelease.slug,
        title: productRelease.title,
        priceCents: releaseMarket.priceCents,
        version: productRelease.version,
        releaseId: productRelease.id,
      })
      .from(product)
      // INNER join: no active release means no row, fail-closed.
      .innerJoin(productRelease, eq(productRelease.id, product.activeReleaseId))
      // INNER join: not sold in this market means no row either.
      .innerJoin(
        releaseMarket,
        and(
          eq(releaseMarket.releaseId, productRelease.id),
          eq(releaseMarket.market, market),
          eq(releaseMarket.active, true),
        ),
      )
      .where(eq(product.status, "active"))
      .orderBy(asc(productRelease.title)),
  );
  if (rows.length === 0) return [] as ProductCardDTO[];

  /**
   * JOINED, not filtered by an id list — and the difference is a hard cliff.
   *
   * D1 allows at most 100 BOUND PARAMETERS PER QUERY. An `inArray` over the
   * active releases spends one parameter per active product, so this query threw
   * the moment the shop had a hundred live products, and it is the STOREFRONT
   * LIST: the whole shop goes down at once, at a size nobody notices approaching.
   *
   * Re-deriving the active set inside the query costs zero parameters and no
   * extra round trip, so there is no size at which it stops working.
   */
  const covers = yield* query(() =>
    db
      .select({
        releaseId: productReleaseImage.releaseId,
        imageId: productReleaseImage.imageId,
        position: productReleaseImage.position,
      })
      .from(productReleaseImage)
      .innerJoin(product, eq(product.activeReleaseId, productReleaseImage.releaseId))
      .where(eq(product.status, "active"))
      .orderBy(asc(productReleaseImage.position), asc(productReleaseImage.imageId)),
  );

  /**
   * THE COVER IS POSITION ZERO. Not "the image marked cover, falling back to
   * the lowest position" — that rule had two sources of truth for one question,
   * and they could disagree: an operator who dragged a new photograph to the
   * front still saw the old one on the listing, because the old one still wore
   * the label. The order an operator arranged IS the answer, and the first row
   * of an ordered scan is it.
   *
   * `(position, imageId)` so a tie resolves the same way on every read — the
   * position index is not unique, by design.
   */
  const coverByRelease = new Map<string, string>();
  for (const image of covers) {
    if (!coverByRelease.has(image.releaseId)) coverByRelease.set(image.releaseId, image.imageId);
  }

  return rows.map(
    (row): ProductCardDTO => ({
      slug: row.slug,
      title: row.title,
      priceCents: row.priceCents,
      currency: MARKETS[market].currency,
      version: row.version,
      coverHref: coverByRelease.has(row.releaseId)
        ? mediaHref(coverByRelease.get(row.releaseId) as string)
        : null,
    }),
  );
});

/**
 * One product by slug.
 *
 * The slug is matched on the RELEASE, not the identity row: renaming a product's
 * slug in the draft must not break the URL of what is currently published.
 */
export const getActiveProductBySlug = Effect.fn("Storefront.getActiveProductBySlug")(function* (
  db: ClassicDb,
  slug: string,
  market: MarketCode,
) {
  const rows = yield* query(() =>
    db
      .select({
        productId: product.id,
        releaseId: productRelease.id,
        slug: productRelease.slug,
        title: productRelease.title,
        descriptionMarkdown: productRelease.descriptionMarkdown,
        /**
         * The two optional panels, read from the RELEASE like everything else
         * on this page. A null here is the whole reason the storefront renders
         * no accordion rather than an empty one.
         */
        detailsMarkdown: productRelease.detailsMarkdown,
        sizeGuideAssetId: productRelease.sizeGuideAssetId,
        sizeGuideAlt: productRelease.sizeGuideAlt,
        sizeGuideNotesMarkdown: productRelease.sizeGuideNotesMarkdown,
        priceCents: releaseMarket.priceCents,
        version: productRelease.version,
        /** The run, because `available` below is a claim about BOTH counters. */
        preorderCap: product.preorderCap,
        preorderClaimed: product.preorderClaimed,
      })
      .from(product)
      .innerJoin(productRelease, eq(productRelease.id, product.activeReleaseId))
      // Not sold in this market reads as `null` — the same answer as no such
      // product, because for this shopper that is what it is.
      .innerJoin(
        releaseMarket,
        and(
          eq(releaseMarket.releaseId, productRelease.id),
          eq(releaseMarket.market, market),
          eq(releaseMarket.active, true),
        ),
      )
      .where(and(eq(product.status, "active"), eq(productRelease.slug, slug)))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;

  /**
   * ORDER IS THE ONLY THING THAT DECIDES PRESENTATION, so this scan IS the
   * gallery: index 0 is what the page opens on, and the filmstrip numbers the
   * rest `01`, `02`, `03` from there. No role travels, because there is none —
   * the storefront receives a list and renders it in order rather than
   * branching on labels at render time.
   */
  const media = yield* query(() =>
    db
      .select({
        imageId: productReleaseImage.imageId,
        alt: productReleaseImage.alt,
      })
      .from(productReleaseImage)
      .where(eq(productReleaseImage.releaseId, row.releaseId))
      .orderBy(asc(productReleaseImage.position), asc(productReleaseImage.imageId)),
  );

  /**
   * Variants are LIVE, not frozen. Inventory sits outside the release model on
   * purpose — a release must never pin stock, or republishing would resurrect
   * sold-out sizes.
   */
  const variants = yield* query(() =>
    db
      .select({
        id: productVariant.id,
        size: productVariant.size,
        stock: productVariant.stock,
        /** Which counters a sale of this size has to pass. See `core/availability.ts`. */
        mode: productVariant.mode,
      })
      .from(productVariant)
      .where(eq(productVariant.productId, row.productId)),
  );

  return {
    slug: row.slug,
    title: row.title,
    descriptionMarkdown: row.descriptionMarkdown,
    detailsMarkdown: row.detailsMarkdown,
    /**
     * WHOLE OR ABSENT. The asset reference is what decides — alt text and fit
     * comments with no chart to caption are not a `Size & fit` panel, they are
     * leftovers from one, and rendering an accordion for them would put an
     * empty drawer on a live product page.
     *
     * The alt falls back to a plain description of what the plate IS rather
     * than to an empty string: a missing alt on a chart carrying every
     * measurement a shopper needs is the one place this page cannot be silent.
     */
    sizeGuide:
      row.sizeGuideAssetId === null
        ? null
        : {
            href: mediaHref(row.sizeGuideAssetId),
            alt: row.sizeGuideAlt ?? `Measurement chart for ${row.title}`,
            notesMarkdown: row.sizeGuideNotesMarkdown,
          },
    priceCents: row.priceCents,
    currency: MARKETS[market].currency,
    version: row.version,
    media: media.map((image) => ({
      href: mediaHref(image.imageId),
      alt: image.alt,
    })),
    variants: sortBySize(variants).map((variant) => ({
      id: variant.id,
      size: variant.size,
      // Exact stock is never published — it is a competitive signal, and the
      // shopper only needs to know whether they can buy it.
      //
      // BOTH COUNTERS, via `core/availability.ts`. This used to be
      // `variant.stock > 0`, which advertised every size of a fully-subscribed
      // run as buyable and refused at Buy.
      available: isAvailable({
        stock: variant.stock,
        mode: variant.mode,
        runCap: row.preorderCap,
        runClaimed: row.preorderClaimed,
      }),
    })),
  } satisfies StorefrontProductDTO;
});
