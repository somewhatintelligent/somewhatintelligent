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
import {
  mediaHref,
  type ProductCardDTO,
  type ProductMediaRole,
  type StorefrontProductDTO,
} from "./Contracts.ts";
import { sortBySize } from "../core/money.ts";
import { product, productRelease, productReleaseImage, productVariant } from "./Schema.ts";

/**
 * The storefront list. `active` only — `unavailable` is a published product
 * pulled from sale and must not appear, which is precisely the distinction the
 * four-value status domain exists to carry.
 */
export const listActiveProducts = Effect.fn("Storefront.listActiveProducts")(function* (
  db: ClassicDb,
) {
  const rows = yield* query(() =>
    db
      .select({
        productId: product.id,
        slug: productRelease.slug,
        title: productRelease.title,
        priceCents: productRelease.priceCents,
        version: productRelease.version,
        releaseId: productRelease.id,
      })
      .from(product)
      // INNER join: no active release means no row, fail-closed.
      .innerJoin(productRelease, eq(productRelease.id, product.activeReleaseId))
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
        role: productReleaseImage.role,
        position: productReleaseImage.position,
      })
      .from(productReleaseImage)
      .innerJoin(product, eq(product.activeReleaseId, productReleaseImage.releaseId))
      .where(eq(product.status, "active"))
      .orderBy(asc(productReleaseImage.position)),
  );

  /**
   * The cover is the first image with role `cover`, falling back to the
   * lowest-positioned image. A product whose operator never marked a cover
   * still shows something rather than a blank card.
   */
  const coverByRelease = new Map<string, string>();
  for (const image of covers) {
    const existing = coverByRelease.get(image.releaseId);
    if (!existing) coverByRelease.set(image.releaseId, image.imageId);
    else if (image.role === "cover") coverByRelease.set(image.releaseId, image.imageId);
  }

  return rows.map(
    (row): ProductCardDTO => ({
      slug: row.slug,
      title: row.title,
      priceCents: row.priceCents,
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
) {
  const rows = yield* query(() =>
    db
      .select({
        productId: product.id,
        releaseId: productRelease.id,
        slug: productRelease.slug,
        title: productRelease.title,
        descriptionMarkdown: productRelease.descriptionMarkdown,
        priceCents: productRelease.priceCents,
        version: productRelease.version,
      })
      .from(product)
      .innerJoin(productRelease, eq(productRelease.id, product.activeReleaseId))
      .where(and(eq(product.status, "active"), eq(productRelease.slug, slug)))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;

  const media = yield* query(() =>
    db
      .select({
        imageId: productReleaseImage.imageId,
        alt: productReleaseImage.alt,
        role: productReleaseImage.role,
      })
      .from(productReleaseImage)
      .where(eq(productReleaseImage.releaseId, row.releaseId))
      .orderBy(asc(productReleaseImage.position)),
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
      })
      .from(productVariant)
      .where(eq(productVariant.productId, row.productId)),
  );

  return {
    slug: row.slug,
    title: row.title,
    descriptionMarkdown: row.descriptionMarkdown,
    priceCents: row.priceCents,
    version: row.version,
    media: media.map((image) => ({
      href: mediaHref(image.imageId),
      alt: image.alt,
      role: image.role as ProductMediaRole,
    })),
    variants: sortBySize(variants).map((variant) => ({
      id: variant.id,
      size: variant.size,
      // Exact stock is never published — it is a competitive signal, and the
      // shopper only needs to know whether they can buy it.
      available: variant.stock > 0,
    })),
  } satisfies StorefrontProductDTO;
});
