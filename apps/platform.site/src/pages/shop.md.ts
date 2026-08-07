/**
 * `GET /shop.md` — the ledger as markdown.
 *
 * THE SAME MARKET COOKIE THE HTML PAGE READS, so the prices in the twin are the
 * prices on the page. A twin priced in a market the reader is not in would be
 * worse than no twin: it reads as authoritative and is wrong by a currency.
 *
 * AN UNREACHABLE CATALOGUE IS A 503 THAT STILL HAS A BODY, which is the same
 * split the HTML page makes: the status is for the crawler, which must come back
 * rather than record an empty shop, and the note is for whatever read the body
 * anyway. A twin that returned 200 and "no objects are published yet" during an
 * outage would be the one failure nobody reports.
 */
import type { APIRoute } from "astro";

import { MARKET_COOKIE, parseMarket } from "../core/market.ts";
import { shopMarkdown } from "../core/page-markdown.ts";
import { listStorefrontOrEmpty } from "../lib/commerce.ts";
import { markdownResponse } from "../lib/text-response.ts";
import { SHOP_DOCUMENT } from "../lib/shop-document.ts";

export const prerender = false;

export const GET: APIRoute = async ({ cookies, url }) => {
  const market = parseMarket(cookies.get(MARKET_COOKIE)?.value);

  const { products, reachable } = await listStorefrontOrEmpty(market, "shop.md");

  return markdownResponse(shopMarkdown(url.origin, SHOP_DOCUMENT, products, reachable), {
    status: reachable ? 200 : 503,
  });
};
