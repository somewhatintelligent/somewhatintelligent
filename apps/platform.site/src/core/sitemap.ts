/**
 * THE SITEMAP DOCUMENT, built where it can be tested — the endpoint that serves
 * it holds a binding and this does not.
 *
 * `<loc>` AND NOTHING ELSE. `<changefreq>` and `<priority>` are ignored by
 * Google outright, and `<lastmod>` is only honoured when a site is consistently
 * accurate about it — the storefront DTO carries a release version but no
 * modification timestamp, so every date this could emit would be invented. A
 * sitemap that lies about freshness is worse than one that says nothing about
 * it: the lie is what makes the field ignored for the sites that could have
 * used it.
 */
import { absoluteUrl } from "./site.ts";

/**
 * The routes that exist whatever the catalogue says.
 *
 * WHAT IS ABSENT IS THE LIST: `/cart` and `/orders/<number>` are one person's
 * transaction and are `noindex` in the markup already, and `/404` is not a page.
 * A sitemap naming a `noindex` URL is a contradiction a crawler reports as an
 * error rather than resolving.
 */
export const STATIC_PATHS: readonly string[] = [
  "/",
  "/shop",
  "/software",
  "/writing",
  "/about",
  "/shipping",
  "/refunds",
  "/terms",
  "/privacy",
];

/**
 * The routes that exist and are deliberately NOT in the sitemap. Kept as data,
 * not as a comment, because `test/crawl-surfaces.test.ts` walks `src/pages/` and
 * fails when a route appears in neither list — a new page silently missing from
 * the sitemap is invisible by construction otherwise, and the checklist in
 * `docs/metadata-and-crawl-surfaces.md` was documentation standing in for a
 * mechanism.
 *
 * It cannot be derived instead: alchemy's `Cloudflare.Website.Astro` does not
 * read an `astro.config`, so `@astrojs/sitemap` and the `astro:build:done` route
 * list are both unreachable here — and an allowlist is the safer default anyway
 * for a document whose failure mode is publishing a `noindex` URL.
 */
export const NOT_INDEXED: readonly string[] = [
  /** One person's transaction, `noindex` in the markup. */
  "/cart",
  "/orders/[number]",
  /** Not a page. */
  "/404",
  /** Machine surfaces: POST endpoints, an image stream, and the crawl files themselves. */
  "/api/checkout",
  "/api/order",
  "/media/[id]",
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
  /** The markdown twins. Advertised per-page via `rel="alternate"`, and in `llms.txt`. */
  "/index.md",
  "/about.md",
  "/shop.md",
  "/writing.md",
  "/software.md",
  "/shop/[slug].md",
  "/writing/[slug].md",
  /** The dynamic product route — its members come from the catalogue, not this list. */
  "/shop/[slug]",
  /** The dynamic text route — its members come from the content collection. */
  "/writing/[slug]",
];

/** The five characters XML cannot carry raw. A slug is not trusted to lack them. */
export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Every address on the site, static routes first, then objects in the order the
 * catalogue returned them, then texts in the order the collection did.
 *
 * Product slugs are DEDUPED because the caller unions two markets: a product on
 * sale in both Canada and the United States is one URL, not two — the market
 * changes the prices a page renders, never its address. Text slugs come from
 * one filesystem read and cannot repeat, but they are passed through the same
 * `Set` so the two members of this list behave identically.
 *
 * TEXTS ARE A SECOND PARAMETER RATHER THAN A SECOND CALL, because a sitemap is
 * the complete address list or it is a bug: composing it in one place is what
 * makes "did we forget a route" a question `crawl-surfaces.test.ts` can answer.
 */
export const sitemapPaths = (
  slugs: readonly string[],
  textSlugs: readonly string[] = [],
): readonly string[] => [
  ...STATIC_PATHS,
  /** `Set` preserves insertion order, so the catalogue's ordering survives. */
  ...new Set(slugs).values().map((slug) => `/shop/${slug}`),
  ...new Set(textSlugs).values().map((slug) => `/writing/${slug}`),
];

export const sitemapXml = (origin: string, paths: readonly string[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((path) => `  <url><loc>${escapeXml(absoluteUrl(origin, path))}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
