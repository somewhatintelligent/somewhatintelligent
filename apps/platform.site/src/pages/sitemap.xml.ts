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

import { getCollection } from "astro:content";

import { sitemapPaths, sitemapXml } from "../core/sitemap.ts";
import { isProductionHost } from "../core/site.ts";
import { publishedRows } from "../core/writing-view.ts";
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

  /**
   * The texts, read AFTER the catalogue and outside its `try`: this is a
   * compiled data store bundled into the Worker, not a binding, so it has no
   * transient failure to be forgiving of — and `includeDrafts: false` is
   * unconditional here rather than keyed to the build, because a sitemap is a
   * production artifact and an unfinished text has no business in one.
   */
  const textSlugs = publishedRows(
    (await getCollection("writing")).map((entry) => ({
      slug: entry.id,
      title: entry.data.title,
      deck: entry.data.deck,
      kind: entry.data.kind,
      date: entry.data.date,
      updated: entry.data.updated,
      draft: entry.data.draft,
      body: entry.body ?? "",
    })),
    { includeDrafts: false },
  ).map((row) => row.slug);

  return textResponse(sitemapXml(url.origin, sitemapPaths(slugs, textSlugs)), {
    type: "application/xml",
    maxAge: CACHE_HOURLY,
  });
};
