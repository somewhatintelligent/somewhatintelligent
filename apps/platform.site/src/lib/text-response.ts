/**
 * The one response shape every plain-text crawl surface returns — the markdown
 * twins, `robots.txt`, `llms.txt`.
 *
 * `text/markdown` for the twins rather than `text/plain`: it is the media type
 * the format has (RFC 7763), it is what the fetchers that go looking for these
 * files match on, and a browser that does not know it downloads the file instead
 * of rendering a wall of asterisks — the correct outcome for a document meant
 * for a machine.
 */

/**
 * WHAT THESE ACTUALLY BIND, because it is easy to assume more.
 *
 * A Worker's own `Cache-Control` does NOT put the response in Cloudflare's edge
 * cache — that takes a Cache Rule on the zone, or an explicit `caches.default`
 * put in the handler. So these values instruct the CRAWLER's cache and any
 * third-party proxy, and nothing else: the Worker still boots and the live ones
 * still hit the commerce binding on every request. Worth having, worth not
 * mistaking for origin protection.
 */

/** A day. For documents that cannot change without a deploy. */
export const CACHE_STATIC = 86_400;
/** An hour. Long enough that a well-behaved crawler stops re-asking, short
 *  enough that flipping a content signal takes effect the same afternoon. */
export const CACHE_HOURLY = 3_600;
/** Five minutes. For anything reading live commerce. */
export const CACHE_LIVE = 300;

export const textResponse = (
  body: string,
  {
    type = "text/markdown",
    maxAge,
    status = 200,
  }: { type?: string; maxAge: number; status?: number },
): Response =>
  new Response(body, {
    status,
    headers: {
      "content-type": `${type}; charset=utf-8`,
      /**
       * A FAILURE IS NEVER CACHEABLE. A 5xx is not stored by default, but an
       * explicit `max-age` makes it so — which would pin the degraded document
       * ("the catalogue could not be read") for exactly as long as the healthy
       * one, in exactly the intermediaries the 503 exists to keep away from
       * stale data. The status is chosen to say "come back"; the header has to
       * agree with it.
       */
      "cache-control": status >= 400 ? "no-store" : `public, max-age=${maxAge}`,
    },
  });

/**
 * A markdown twin. `maxAge` is a parameter rather than a constant because the
 * six twins do not change alike: four render from committed documents and
 * cannot move without a deploy, while `/shop.md` and `/shop/<slug>.md` read live
 * commerce. One shared value would have invited a crawler back 288 times a day
 * for the four that are byte-identical between deploys.
 */
export const markdownResponse = (
  body: string,
  { maxAge = CACHE_LIVE, status = 200 }: { maxAge?: number; status?: number } = {},
): Response => textResponse(body, { type: "text/markdown", maxAge, status });
