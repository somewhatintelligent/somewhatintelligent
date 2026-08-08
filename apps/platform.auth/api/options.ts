import type { BetterAuthOptions } from "better-auth";
import { deriveFeatures, type AuthFeatures } from "lib.better-auth-manifest";
import * as Effect from "effect/Effect";

import { authConfig } from "./config.ts";
import { inertly } from "./inert.ts";

/**
 * The Better Auth configuration, resolved against STAND-INS rather than the
 * Worker's capabilities.
 *
 * The schema generator and the feature manifest both read it, and both have to
 * agree with the worker about the two things they actually consume — the
 * plugin set and each plugin's schema — hence this Effect rather than a second
 * description of the config. `Effect.cached` is what makes the two readers share
 * one answer instead of building the plugin set twice.
 *
 * NOT byte-identical to what the worker runs, and it never could be: `inertly`
 * supplies capabilities that no module-scope resolution can have, so any option
 * VALUE derived from one legitimately differs. `Billing` is the live example —
 * it resolves to "no account" here and to the real Stripe account inside the
 * worker's init, so `createCustomerOnSignUp` differs between the two. That is
 * inert for both readers above, and it is a hazard worth knowing about: a
 * manifest field that ever reads a plugin's OPTIONS rather than its id would be
 * reading this resolution's answer, not the worker's.
 */
export const authOptions: Effect.Effect<BetterAuthOptions> = Effect.runSync(
  Effect.cached(Effect.scoped(Effect.provide(authConfig, inertly)).pipe(Effect.orDie)),
);

/** The manifest, off the same memoised options. Read by the stack and the app's defines. */
export const authFeatures: Effect.Effect<AuthFeatures> = Effect.map(authOptions, deriveFeatures);
