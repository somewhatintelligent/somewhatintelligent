/**
 * `GET /sitemap.xml` — every address on this site, composed per request.
 *
 * NOT `@astrojs/sitemap`, AND NOT BECAUSE OF TASTE. That integration walks the
 * routes it can see AT BUILD TIME; `/shop/[slug]` is an on-demand route whose
 * values live in the commerce database, so the only product URL a build-time
 * pass could ever emit is the literal `[slug]`. A storefront's sitemap is a
 * read against the catalogue or it is empty.
 *
 * BOTH MARKETS ARE ASKED. `listStorefront` hides a product with no live row in
 * the market it was asked about, so a US-only object is invisible to a Canadian
 * read. The market decides prices, never addresses — the union is the set of
 * pages that resolve, which is exactly what a sitemap is for.
 */
import type { APIRoute } from "astro";

import { sitemapPaths, sitemapXml } from "../core/sitemap.ts";
import { isProductionHost } from "../core/site.ts";
import { listStorefront } from "../lib/commerce.ts";
import { CACHE_HOURLY, textResponse } from "../lib/text-response.ts";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  /**
   * A STAGE PUBLISHES NO SITEMAP. `robots.txt` already disallows everything off
   * production; serving the map anyway would hand a crawler that ignored it the
   * complete address list it was told not to have.
   */
  if (!isProductionHost(url.hostname)) return new Response(null, { status: 404 });

  let slugs: string[];
  try {
    const [ca, us] = await Promise.all([listStorefront("CA"), listStorefront("US")]);
    slugs = [...ca, ...us].map((product) => product.slug);
  } catch (cause) {
    /**
     * 503, NOT A SHORT SITEMAP. A crawler treats a 5xx as "come back later" and
     * keeps the last map it has; a 200 listing only the static routes tells it
     * every object has been withdrawn, and it acts on that.
     */
    console.error("site.sitemap.list_failed", cause);
    return new Response(null, { status: 503 });
  }

  return textResponse(sitemapXml(url.origin, sitemapPaths(slugs)), {
    type: "application/xml",
    maxAge: CACHE_HOURLY,
  });
};
