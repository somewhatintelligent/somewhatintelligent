/**
 * The manifest as a Better Auth plugin: one unauthenticated GET answering what
 * the deployment has switched on.
 *
 * For an app that cannot import the configuration — a separate repository, a
 * separate release cadence, one bundle serving several deployments. An app
 * built alongside its backend should import {@link deriveFeatures}' result as a
 * constant instead: same answer, no fetch, and a missing feature becomes a
 * compile error rather than an empty list.
 *
 * Publishing the list is not a disclosure. Which sign-in methods a deployment
 * offers is already discoverable a request at a time, and nothing secret is
 * readable here anyway — a plugin object exposes endpoints, schema and hooks,
 * never the options it was constructed with.
 *
 * `trustedOrigins` is deliberately NOT published, though it is resolvable: an
 * app needs it only to decide where it may redirect, and that decision belongs
 * to the app's own configuration rather than to a list fetched from the server
 * it is redirecting away from.
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
