/**
 * Pure display helpers — no worker bindings here, so this module is safe to
 * import from anywhere including client scripts.
 */

/**
 * Format integer cents as `$68 CAD` (whole) or `$68.50 CAD` (fractional).
 *
 * CENTS IN, and the currency is not a parameter. Prices cross the wire as
 * integers and carry no currency of their own — `product_release` has a price
 * column and no currency column, and an order's only defaults to `cad` — so a
 * currency argument here would be a second place to disagree about a value the
 * substrate holds exactly once. It becomes a parameter the day a price does.
 */
export function formatPrice(priceCents: number): string {
  const dollars = priceCents / 100;
  const body = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${body} CAD`;
}

/** Format an epoch-ms timestamp as `18 Jul 2026` (UTC, locale-stable). */
export function formatDate(epochMs: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(epochMs));
}

/** Stable public URL for a Publisher media id — the `/media/:id` path the site
 *  this replaces forwarded to `PublisherPublic.openPublishedMedia`. Nothing
 *  serves that route in this scaffold; the helper exists so a document carrying
 *  a media id renders the same href it always did once the route returns. */
export function publisherMediaHref(mediaId: string): string {
  return `/media/${mediaId}`;
}
