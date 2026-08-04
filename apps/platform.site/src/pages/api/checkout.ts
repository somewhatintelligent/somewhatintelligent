/**
 * `POST /api/checkout` — the one write path this site exposes.
 *
 * It takes a cart, asks Commerce to place the order, and answers with where to
 * send the buyer to pay. It cannot do anything else: `src/lib/commerce.ts`
 * exports exactly three calls and no passthrough, so the binding's other thirty
 * methods are unreachable from here even though the stub grants them.
 *
 * WHAT IT DOES NOT TRUST: prices, titles, stock, or totals. Only variant ids
 * and quantities cross. Commerce re-loads each active release and re-prices the
 * whole cart, so the worst a forged body can do is order something at the price
 * the shop is actually charging.
 *
 * JSON RATHER THAN A FORM POST, and not for taste — the cart lives in
 * `localStorage`, so the lines have to be assembled by script whatever the
 * content type. A form would mean JS writing hidden inputs to submit them,
 * which is the same trust boundary wearing a costume.
 *
 * STILL TO DO BEFORE THIS TAKES REAL MONEY: a Cloudflare rate-limiting rule on
 * this path. Reservations self-heal — `Reconcile.sweep` expires an unpaid order
 * after fifteen minutes and returns its stock — so ordinary order spam is
 * bounded. A CAPPED PRE-ORDER RUN IS NOT: its counter is one shared number, so
 * someone can claim an entire run for free and re-claim it every sweep cycle
 * while the shop reads "sold out". That is the case the rule is for.
 */
import type { APIRoute } from "astro";

import { parseCheckout } from "../../core/checkout-input.ts";
import { placeOrder } from "../../lib/commerce.ts";

export const prerender = false;

const bad = (error: string, status = 400): Response =>
  new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * CRAP, not complexity — the branches are two `try`/`catch` pairs and a null
 * check, and every field rule they delegate to is pure and tested. See the note
 * in `src/core/checkout-input.ts`.
 */
// fallow-ignore-next-line complexity
export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bad("malformed");
  }

  /** Every field rule lives in `src/core/checkout-input.ts` and is pure. */
  const parsed = parseCheckout(body);
  if (!parsed.ok) return bad(parsed.error);

  try {
    const result = await placeOrder(parsed.value);
    if (!result.ok) {
      /**
       * REFUSALS ARE VALUES AND THEY ARE FORWARDED VERBATIM. `out_of_stock`,
       * `preorder_full` and `product_unavailable` each tell the buyer something
       * different and actionable; flattening them into "checkout failed" throws
       * away the only useful thing the domain said.
       */
      return bad(result.error, 409);
    }
    return new Response(JSON.stringify({ ok: true, ...result.value }), {
      headers: { "content-type": "application/json" },
    });
  } catch (cause) {
    // The binding or the provider failed. Logged, never returned — a driver
    // message is free reconnaissance and tells the buyer nothing they can act on.
    console.error("site.checkout.failed", cause);
    return bad("unavailable", 503);
  }
};
