/**
 * Pure display helpers — no worker bindings here, so this module is safe to
 * import from anywhere including client scripts.
 */

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
