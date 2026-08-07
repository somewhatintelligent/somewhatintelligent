/**
 * `GET /shop/<slug>.md` — one object as markdown.
 *
 * THE THREE ANSWERS ARE THE PAGE'S THREE ANSWERS, and for the same reasons:
 * `null` from the domain is a real 404, a throw from the binding is a 503
 * because the object may well exist, and anything else is the object. A twin
 * that answered 404 to an outage would tell an agent the product was withdrawn.
 */
import type { APIRoute } from "astro";

import { MARKET_COOKIE, parseMarket } from "../../core/market.ts";
import { productMarkdown } from "../../core/page-markdown.ts";
import { getStorefrontProduct } from "../../lib/commerce.ts";
import { markdownResponse } from "../../lib/markdown-response.ts";

export const prerender = false;

export const GET: APIRoute = async ({ cookies, params, url }) => {
  const slug = params.slug;
  if (!slug) return new Response(null, { status: 404 });

  /** The market prices the twin, exactly as it prices the page. */
  const market = parseMarket(cookies.get(MARKET_COOKIE)?.value);

  let product: Awaited<ReturnType<typeof getStorefrontProduct>>;
  try {
    product = await getStorefrontProduct(slug, market);
  } catch (cause) {
    console.error("site.shop.product_md_failed", cause);
    return new Response(null, { status: 503 });
  }
  if (!product) return new Response(null, { status: 404 });

  return markdownResponse(productMarkdown(url.origin, product));
};
