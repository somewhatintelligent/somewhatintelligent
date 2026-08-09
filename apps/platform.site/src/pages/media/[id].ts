/**
 * `GET /media/:id` — product images, streamed from the commerce Media worker.
 *
 * WHY THIS ROUTE EXISTS AT ALL. `Contracts.mediaHref` spells a media address as
 * the root-relative `/media/<id>`, so the href is part of the data a product row
 * carries rather than something a consumer composes. Serving it here means one
 * origin for the page and its images: no CORS, no second hostname in the markup,
 * and no rewrite pass over every row.
 *
 * A BINDING, NOT A FETCH TO A PUBLIC URL. The Media worker does have one, but
 * routing through the binding keeps the hop inside the account and means this
 * site never has to hold — or leak — another origin.
 *
 * THE UPSTREAM RESPONSE PASSES THROUGH UNTOUCHED. Media already sets the
 * content type and an immutable one-year cache header (a media id names exactly
 * one set of bytes forever), and it decides what is public: `openMedia` joins
 * through `product.status = 'active'`, so an archived product's images stop
 * being served the moment it is archived. Re-deriving any of that here would be
 * a second policy to keep in step with the first — and the one that ships the
 * bytes should be the one that decides they are public.
 *
 * The body is a STREAM and is forwarded as one. Buffering an image into a
 * Worker's memory to hand it straight back is pure cost.
 */
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return new Response(null, { status: 404 });

  try {
    /**
     * The path is REBUILT rather than the inbound request forwarded as-is.
     * Media matches `/media/:id` exactly and refuses anything else, so a query
     * string or a stray trailing segment on the way in would 404 against a
     * worker that holds the bytes. `encodeURIComponent` because the id lands in
     * a path segment.
     */
    const upstream = new URL(`/media/${encodeURIComponent(id)}`, request.url);

    /**
     * THE ACCESS ASSERTION IS FORWARDED, and without it every product image on
     * every preview is a 403.
     *
     * This hop is a SERVICE BINDING: it never leaves the account, so it never
     * passes the Access edge and nothing would otherwise attach an assertion to
     * it. Media verifies in-band like every other gated worker, so a request
     * built from scratch — which is what this was — arrives with no header at
     * all and is refused. The browser's `<img>` goes to THIS origin (the href
     * is root-relative `/media/<id>`), so the edge stamped the header on the
     * request that reached `src/middleware.ts`; passing it along is what makes
     * the in-band check on the far side meaningful rather than fatal.
     *
     * Absent on production and under `alchemy dev`, where both ends are
     * ungated. Copying a header that is not there is a no-op.
     */
    const assertion = request.headers.get("Cf-Access-Jwt-Assertion");

    return await env.MEDIA.fetch(upstream, {
      method: "GET",
      ...(assertion === null ? {} : { headers: { "Cf-Access-Jwt-Assertion": assertion } }),
    });
  } catch {
    // The binding itself failed — the image is not missing, the hop is. 502
    // says so; a 404 here would read as "this product has no cover".
    return new Response(null, { status: 502 });
  }
};
