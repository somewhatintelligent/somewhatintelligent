/**
 * `POST /api/order` — a customer reading their own order.
 *
 * A POST FOR A READ, deliberately. The lookup needs the email the order was
 * placed with, and an address must not travel in a URL: query strings land in
 * browser history, in a `Referer` header on every outbound link, and in any log
 * that records paths. A body keeps it out of all three.
 *
 * The order number alone is NOT a credential — it is derived from an id tail
 * and gets quoted in receipts and support threads. Commerce enforces the email
 * match itself and answers a mismatch with the same `not_found` a nonexistent
 * order gets, so this never confirms that a number is real.
 */
import type { APIRoute } from "astro";

import { parseOrderLookup } from "../../core/checkout-input.ts";
import { getMyOrder } from "../../lib/commerce.ts";

export const prerender = false;

const json = (payload: unknown, status: number, cache = "no-store"): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache },
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
    return json({ ok: false }, 400);
  }

  const asked = parseOrderLookup(body);
  if (asked === null) return json({ ok: false }, 400);

  try {
    const order = await getMyOrder(asked.orderNumber, asked.email);
    /**
     * 404 FOR BOTH "no such order" AND "wrong address", because Commerce
     * already collapses them — re-separating them here would rebuild the
     * enumeration oracle the collapse exists to remove.
     */
    return order === null ? json({ ok: false }, 404) : json({ ok: true, order }, 200);
  } catch (cause) {
    console.error("site.order.lookup_failed", cause);
    return json({ ok: false }, 503);
  }
};
