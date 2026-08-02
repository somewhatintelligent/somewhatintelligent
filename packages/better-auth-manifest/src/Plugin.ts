/**
 * The manifest as a Better Auth plugin: one unauthenticated GET that answers
 * what the deployment has switched on.
 *
 * This is the delivery mode for an app that cannot import the configuration —
 * a separate repository, a separate release cadence, or one bundle serving
 * several deployments. An app built alongside its backend should import
 * {@link deriveFeatures}' result as a constant instead: same answer, no fetch,
 * and a missing feature becomes a compile error rather than an empty list.
 *
 * ## What it publishes, and why that is not a disclosure
 *
 * Which sign-in methods a deployment offers is already discoverable a request
 * at a time — Better Auth answers `404` for a route no plugin mounted, and a
 * sign-in page shows its own buttons. Publishing the list changes how long
 * enumeration takes and nothing about what is knowable. Nothing secret is
 * readable from here in the first place: a plugin object exposes endpoints,
 * schema and hooks, never the options it was constructed with.
 *
 * `trustedOrigins` is deliberately NOT published. It is resolvable here — the
 * context carries it already resolved, even when the option was written as a
 * function — but an app needs it only to decide where it may redirect after an
 * operation, and that decision belongs to the app's own configuration rather
 * than to a list it fetches from the server it is redirecting away from.
 */

import { createAuthEndpoint } from "better-auth/api";
import { type AuthFeatures, deriveFeatures } from "./Features.ts";

export interface ManifestOptions {
  /**
   * The path, relative to Better Auth's `basePath`. Defaults to `/manifest`,
   * so a default deployment answers at `/api/auth/manifest`.
   */
  readonly path?: string;
  /**
   * Rewrite the derived value before it is served.
   *
   * The escape hatch for the two things that cannot be read off the options: a
   * captcha SITE key, and anything a plugin keeps to itself. Whatever this
   * returns is what the app sees, so a deployment adding a field is stating it
   * rather than deriving it — which is the trade, and it should stay small.
   */
  readonly extend?: (features: AuthFeatures) => AuthFeatures & Record<string, unknown>;
}

export const manifest = (options: ManifestOptions = {}) => {
  const path = options.path ?? "/manifest";

  return {
    id: "manifest",
    endpoints: {
      getAuthManifest: createAuthEndpoint(
        path,
        {
          method: "GET",
          metadata: {
            openapi: {
              description: "The features this deployment has enabled.",
              responses: { "200": { description: "OK" } },
            },
          },
        },
        async (ctx) => {
          const features = deriveFeatures(ctx.context.options);
          return ctx.json(options.extend === undefined ? features : options.extend(features));
        },
      ),
    },
  } as const;
};
