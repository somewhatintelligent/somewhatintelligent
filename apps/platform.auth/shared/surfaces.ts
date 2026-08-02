import type { AuthFeatures } from "better-auth-manifest";

/**
 * The surfaces this app implements, and the ONE list that names them. The
 * deploy projects exactly these out of the manifest; the app reads exactly
 * these.
 *
 * The key IS the define suffix, so `VITE_AUTH_TWO_FACTOR` is derivable from the
 * entry rather than written beside it. The value is the plugin's own Better
 * Auth id — `two-factor`, not `twoFactor` — and nothing checks that at compile
 * time, so `test/surfaces.test.ts` pins every one of them against
 * the real configuration.
 *
 * `jwt` and `bearer` are deliberately absent: they mount no UI, so there is
 * nothing to compile in or out.
 */
export const SURFACES = {
  USERNAME: "username",
  ADMIN: "admin",
  TWO_FACTOR: "two-factor",
  PASSKEY: "passkey",
  DEVICE_AUTHORIZATION: "device-authorization",
  API_KEY: "api-key",
  MAGIC_LINK: "magic-link",
  OAUTH_PROVIDER: "oauth-provider",
  ORGANIZATION: "organization",
} as const satisfies Record<string, string>;

export type SurfaceKey = keyof typeof SURFACES;

/** `VITE_AUTH_PASSKEY`, `VITE_AUTH_TWO_FACTOR`, … */
export type SurfaceFlag = `VITE_AUTH_${SurfaceKey}`;

export interface AuthDefines extends Record<SurfaceFlag, boolean> {
  readonly VITE_AUTH_EMAIL_PASSWORD: boolean;
  /**
   * An ARRAY, not a set of flags, and that difference is the whole design.
   *
   * A `VITE_` value is substituted into the bundle as source text, and rolldown
   * only folds a branch away when the condition is already a literal after the
   * swap. Measured against this repo's bundler: `if (VITE_X)` with a boolean
   * eliminates the branch; a member access on a substituted object literal, and
   * anything behind `JSON.parse`, both survive.
   *
   * So anything you BRANCH on is one boolean above, and anything you ITERATE is
   * here. Rendering one button per provider is a runtime loop either way.
   */
  readonly VITE_AUTH_SOCIAL_PROVIDERS: ReadonlyArray<string>;
}

/** Project a manifest into the defines the Vite build substitutes. */
export const authDefines = (features: AuthFeatures): AuthDefines => ({
  ...(Object.fromEntries(
    Object.entries(SURFACES).map(([key, id]) => [
      `VITE_AUTH_${key}`,
      features.plugins.includes(id),
    ]),
  ) as Record<SurfaceFlag, boolean>),
  VITE_AUTH_EMAIL_PASSWORD: features.emailAndPassword,
  VITE_AUTH_SOCIAL_PROVIDERS: features.socialProviders,
});
