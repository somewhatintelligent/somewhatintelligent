import type { AuthFeatures } from "better-auth-manifest";

/**
 * The surfaces this app implements, and the ONE list that names them.
 *
 * The deploy projects exactly these out of the manifest; the app reads exactly
 * these. Neither side can name a flag the other has not heard of, which is the
 * same rule the manifest itself follows — a second list is a second thing that
 * drifts.
 *
 * The key IS the define suffix, so `VITE_AUTH_TWO_FACTOR` is derivable from the
 * entry rather than written beside it. The value is the plugin's own Better
 * Auth id, read off the plugin object — `two-factor`, not `twoFactor`.
 * `test/surfaces.test.ts` pins every one of these against the real
 * configuration, so a rename upstream fails a test instead of silently turning
 * a surface off.
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

export const EMAIL_PASSWORD_FLAG = "VITE_AUTH_EMAIL_PASSWORD";

export const SOCIAL_PROVIDERS_FLAG = "VITE_AUTH_SOCIAL_PROVIDERS";

export interface AuthDefines extends Record<SurfaceFlag, boolean> {
  readonly [EMAIL_PASSWORD_FLAG]: boolean;
  /**
   * An ARRAY, not a set of flags, and that difference is the whole design.
   *
   * A `VITE_` value is substituted into the bundle as source text, and rolldown
   * only folds a branch away when the condition is already a literal after the
   * swap — a scalar. Measured against this repo's bundler: `if (VITE_X)` with a
   * boolean eliminates the branch; a member access on a substituted object
   * literal, and anything behind `JSON.parse`, both survive.
   *
   * So anything you BRANCH on is one boolean above, and anything you ITERATE is
   * here. Rendering one button per provider is a runtime loop either way, so
   * folding buys nothing and a list is the honest shape.
   */
  readonly [SOCIAL_PROVIDERS_FLAG]: ReadonlyArray<string>;
}

/** Project a manifest into the defines the Vite build substitutes. */
export const authDefines = (features: AuthFeatures): AuthDefines =>
  ({
    ...Object.fromEntries(
      Object.entries(SURFACES).map(([key, id]) => [
        `VITE_AUTH_${key}`,
        features.plugins.includes(id),
      ]),
    ),
    [EMAIL_PASSWORD_FLAG]: features.emailAndPassword,
    [SOCIAL_PROVIDERS_FLAG]: features.socialProviders,
  }) as AuthDefines;
