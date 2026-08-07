/**
 * The one response shape every markdown twin returns.
 *
 * `text/markdown` rather than `text/plain`: it is the media type the format has
 * (RFC 7763), it is what the fetchers that go looking for these files match on,
 * and a browser that does not know it downloads the file instead of rendering a
 * wall of asterisks — which is the correct outcome for a document meant for a
 * machine.
 */
export const markdownResponse = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      /**
       * Five minutes. These are cheap to rebuild and their inputs — a committed
       * document, or a product release — change on human timescales; the cache
       * exists to absorb a crawler taking every page at once, not to pin
       * content.
       */
      "cache-control": "public, max-age=300",
    },
  });
