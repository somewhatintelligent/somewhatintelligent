/** R2 layout. `pub/` is deliberately not owner-scoped: it is what the artifact
 *  origin resolves from a hostname, with no identity in play. */

export const blobKey = (owner: string, sha: string): string => `${owner}/blob/${sha}`;

export const assetKey = (owner: string, etag: string): string => `${owner}/asset/${etag}`;

export const manifestKey = (slug: string, version: number): string =>
  `pub/${slug}/${version}/manifest.json`;

export const liveKey = (slug: string): string => `pub/${slug}/live.json`;

export const mezesPrefix = (slug: string): string => `pub/${slug}/`;

/**
 * A preview grant, both directions. `grant/<token>.json` is what a preview
 * hostname resolves — the only lookup on the serving path — and
 * `pub/<slug>/<n>/grant.json` is what stops a second view minting a second
 * token for the same version. The second lives under `mezesPrefix`, so deleting
 * a mezes takes it; the first does not, and `removeMezes` clears it explicitly.
 */
export const grantKey = (token: string): string => `grant/${token}.json`;

export const versionGrantKey = (slug: string, version: number): string =>
  `pub/${slug}/${version}/grant.json`;

/** The recogniser lives beside the builder, so deletion cannot drift from it. */
export const isVersionGrantKey = (key: string): boolean => key.endsWith("/grant.json");
