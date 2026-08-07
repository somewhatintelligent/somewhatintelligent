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

/** The five characters XML cannot carry raw. A slug is not trusted to lack them. */
export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Every address on the site, static routes first and objects in the order the
 * catalogue returned them.
 *
 * Slugs are DEDUPED because the caller unions two markets: a product on sale in
 * both Canada and the United States is one URL, not two — the market changes
 * the prices a page renders, never its address.
 */
export const sitemapPaths = (slugs: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const productPaths: string[] = [];
  for (const slug of slugs) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    productPaths.push(`/shop/${slug}`);
  }
  return [...STATIC_PATHS, ...productPaths];
};

export const sitemapXml = (origin: string, paths: readonly string[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...paths.map((path) => `  <url><loc>${escapeXml(absoluteUrl(origin, path))}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
