import type { BetterAuthOptions } from "better-auth";
import { deriveFeatures, type AuthFeatures } from "better-auth-manifest";
import * as Effect from "effect/Effect";

import { authConfig } from "./config.ts";
import { inertly } from "./inert.ts";

/**
 * The resolved Better Auth configuration, on the DEPLOY host.
 *
 * The schema generator and the feature manifest both read it, and both have to
 * see the SAME options the worker will run — hence this Effect rather than a
 * second description of the config. `Effect.cached` is what makes the two
 * readers share one answer instead of building the plugin set twice.
 */
export const authOptions: Effect.Effect<BetterAuthOptions> = Effect.runSync(
  Effect.cached(Effect.scoped(Effect.provide(authConfig, inertly)).pipe(Effect.orDie)),
);

/** The manifest, off the same memoised options. Read by the stack and the app's defines. */
export const authFeatures: Effect.Effect<AuthFeatures> = Effect.map(authOptions, deriveFeatures);
