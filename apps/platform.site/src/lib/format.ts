/**
 * Pure display helpers — no worker bindings here, so this module is safe to
 * import from anywhere including client scripts.
 */

/**
 * Format integer cents as `$68 CAD` (whole) or `$68.50 USD` (fractional).
 *
 * CENTS IN, WITH THEIR CURRENCY. The day this promised to become a parameter
 * arrived: every price now crosses the wire beside the minor-unit code of the
 * market it was asked for, so the label comes from the data rather than a
 * constant that was only right in one market.
 */
export function formatPrice(priceCents: number, currency: string): string {
  const dollars = priceCents / 100;
  const body = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${body} ${currency.toUpperCase()}`;
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
