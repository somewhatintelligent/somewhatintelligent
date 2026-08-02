/**
 * Consumer-edited app configuration.
 *
 * This is THE file to change when forking this identity template for a new
 * brand or deployment — everything else in the app imports from here rather
 * than hard-coding a brand/domain/key literal. Replace the placeholder
 * values below with your own; no other file needs to change to pick them up.
 */
export const appConfig = {
  brand: {
    /** Full product/brand name. Shown in wordmarks, page titles, and OG images. */
    name: "somewhatintelligent",
    /** Short uppercase wordmark variant (stacked logo layout). */
    short: "SI",
    /** Support address for outbound transactional email. */
    supportEmail: "hello@somewhatintelligent.ca",
  },

  /**
   * Bouncer attestation public-key set, keyed by `kid`. Passed straight into
   * `createPlatformStartApp({ attestationKeys })`; the envelope verifier in
   * `@somewhatintelligent/auth` accepts any request whose JWS header `kid`
   * matches one of these entries.
   *
   * Public keys are NOT secrets — this file is committed. Replace with your
   * own bouncer's public key(s) before deploying: an empty or placeholder
   * keyset makes every envelope-carrying request fail attestation (auth
   * silently broken). Rotate by adding a new `kid` here first, then flipping
   * bouncer's signing key/`BNC_ATT_KID`, then dropping the old `kid` once its
   * envelopes have expired.
   *
   * `dev` is the well-known dev keypair shared with `scripts/dev-config.ts`
   * (`LOCAL_BNC_ATT_PRIV`); it only signs envelopes on
   * `.somewhatintelligent.localhost`. `production` is paired with
   * si-bouncer-production's `BNC_ATT_PRIV` secret.
   */
  attestationKeys: {
    dev: "MCowBQYDK2VwAyEAfw6nHplwIGKJBTJeITzErHw5kQej7FjhrcNIWEbP5cg=",
    production: "MCowBQYDK2VwAyEAfOxYC2R3pp5KChlmBnpM2TyfPIoFcvbjZT7KO0yjfXU=",
  } as Record<string, string>,
} as const;

export type AppConfig = typeof appConfig;
