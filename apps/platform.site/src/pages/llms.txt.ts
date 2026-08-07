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
import { llmsTxt } from "../core/llms.ts";
import { isProductionHost } from "../core/site.ts";
import { listStorefrontOrEmpty } from "../lib/commerce.ts";
import { CACHE_HOURLY, textResponse } from "../lib/text-response.ts";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  if (!isProductionHost(url.hostname)) return new Response(null, { status: 404 });

  const { products, reachable } = await listStorefrontOrEmpty(HOME_MARKET, "llms");

  /**
   * 503 WITH THE FILE STILL IN THE BODY. The Pages and Optional sections are
   * true whatever the catalogue is doing, so there is a useful document to
   * return — but a 200 would let a reader cache an index with no objects in it,
   * and `textResponse` makes the failure `no-store` so nothing pins it either.
   */
  return textResponse(llmsTxt({ origin: url.origin, products, reachable }), {
    type: "text/plain",
    maxAge: CACHE_HOURLY,
    status: reachable ? 200 : 503,
  });
};
