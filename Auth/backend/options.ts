import type { BetterAuthOptions } from "better-auth";
import { deriveFeatures, type AuthFeatures } from "better-auth-manifest";
import * as Effect from "effect/Effect";

import { inertly } from "./capabilities.ts";
import { authConfig } from "./config.ts";

/**
 * The resolved Better Auth configuration, on the DEPLOY host.
 *
 * `inertly` stands in for everything the configuration would reach for at
 * runtime — the database, the origin — because none of it affects the shape of
 * what is derived here. Two things read this: the schema generator, and the
 * feature manifest. Both must see the SAME options the worker will run, which
 * is why it is this Effect rather than a second description of the config.
 *
 * Memoised at module scope: resolving it twice would build the plugin set
 * twice, and `Effect.cached` is what makes the two readers share one answer.
 */
export const authOptions: Effect.Effect<BetterAuthOptions> = Effect.runSync(
  Effect.cached(Effect.scoped(Effect.provide(authConfig, inertly)).pipe(Effect.orDie)),
);

/** The manifest, off the same memoised options. Read by the stack and the app's defines. */
export const authFeatures: Effect.Effect<AuthFeatures> = Effect.map(authOptions, deriveFeatures);
