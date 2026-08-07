/**
 * `GET /llms.txt` — see `core/llms.ts` for what this file is and what it is
 * honestly worth.
 *
 * NOT SERVED OFF PRODUCTION, for the same reason as the sitemap: `robots.txt`
 * on a stage disallows everything, and an index of every address is precisely
 * what a crawler that ignored it would want.
 *
 * The catalogue is read in the HOME MARKET rather than from a cookie. An agent
 * fetching `/llms.txt` has no market and no session; picking one and saying so
 * in the prose is more useful than pricing the index in whichever market the
 * fetch happened to carry.
 */
import type { APIRoute } from "astro";

import { HOME_MARKET } from "../core/market.ts";
import { llmsTxt, type LlmsProduct } from "../core/llms.ts";
import { isProductionHost } from "../core/site.ts";
import { listStorefront } from "../lib/commerce.ts";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  if (!isProductionHost(url.hostname)) return new Response(null, { status: 404 });

  let products: readonly LlmsProduct[] = [];
  let reachable = true;
  try {
    products = await listStorefront(HOME_MARKET);
  } catch (cause) {
    reachable = false;
    console.error("site.llms.list_failed", cause);
  }

  return new Response(llmsTxt({ origin: url.origin, products, reachable }), {
    /**
     * 503 WITH THE FILE STILL IN THE BODY. The Pages and Optional sections are
     * true whatever the catalogue is doing, so there is a useful document to
     * return — but a 200 would let a reader cache an index with no objects in it.
     */
    status: reachable ? 200 : 503,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
