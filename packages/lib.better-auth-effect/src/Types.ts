/**
 * The types your configuration already implies, without the unwrapping.
 *
 * A configuration is an `Effect<O, E, R>` where `O` carries every plugin's
 * contribution. Getting from there to "what is a User in this deployment"
 * otherwise means two layers of unwrapping and knowing that `$Infer.Session` is
 * where Better Auth hides it:
 *
 * ```ts
 * type User = Auth<Effect.Success<typeof authOptions>>["$Infer"]["Session"]["user"]
 * ```
 *
 * versus
 *
 * ```ts
 * type User = UserOf<typeof authOptions>
 * ```
 *
 * ## They take the CONFIG EFFECT, not the options type
 *
 * `UserOf<typeof authOptions>` rather than `UserOf<AuthOptions>`. One less name
 * for a consumer to declare — and more importantly, it removes the reason to
 * declare one. Writing `const authOptions: Effect<BetterAuthOptions, …>` to
 * have something to reference is one of the two ways to destroy plugin
 * inference, and it has happened twice in this repo. Nothing here gives anyone
 * a reason to reach for it.
 *
 * ## The `any`s are load-bearing
 *
 * `C extends Effect.Effect<infer O, any, any>` — not `unknown`, not `never`.
 * A concrete configuration has real error and requirement channels, and neither
 * `unknown` nor `never` matches them, so a well-meant tightening here breaks
 * every callsite. This is the same constraint that forced
 * `HttpApi.HttpApi<string, any>` elsewhere: a parameter you must admit but must
 * not narrow.
 *
 * ## What is deliberately absent
 *
 * Nothing derived from `plugins` beyond what Better Auth itself infers. Plugin
 * ids are not usefully reachable from the options TYPE — `lib.better-auth-manifest` reads
 * them off the runtime value (`instance.options.plugins[].id`), and that
 * distinction is load-bearing rather than incidental.
 *
 * Every helper here is only as good as the inference it forwards, and inference
 * collapse is silent — `auth.api` degrades to a plugin-free client and nothing
 * errors. `test/types.test.ts` therefore asserts a plugin-contributed field is
 * present AND mutates the config to prove the assertion fails when it is not.
 *
 * ## They found a defect in `Bae` on the day they were written
 *
 * `UserOf` and `SessionOf` did not widen with plugin-contributed fields when a
 * configuration spread `Bae`'s auto-wired plugins:
 *
 * ```ts
 * plugins: [admin()]                     // UserOf<…> HAS `role`
 * plugins: [...base.plugins, admin()]    // UserOf<…> did NOT
 * ```
 *
 * `ApiOf` survived either way, which is why it went unnoticed — the endpoint
 * surface comes through `router<Options>` rather than through the tuple walk,
 * so only the models flattened.
 *
 * The cause was upstream of these helpers: spreading an ARRAY-typed field
 * builds a variadic tuple with a leading rest, which Better Auth's head-first
 * `InferPluginFieldFromTuple` cannot walk past. `Bae.plugins` is now a
 * fixed-length tuple and the contribution lands.
 *
 * Worth keeping for what it says about this file. The defect was a day old and
 * had four capability backings, a live Cloudflare deployment, and a full
 * typecheck over it — none of which could see it, because nothing had ever
 * NAMED the user model. These helpers are what makes that surface assertable.
 * `scripts/probe-plugin-widening.ts` holds the measurement.
 */

import type { Auth, BetterAuthOptions } from "better-auth";
import type { Effect } from "effect";

/** The exact options type a configuration Effect produces. */
export type AuthOptionsOf<C> =
  C extends Effect.Effect<infer O, any, any> ? (O extends BetterAuthOptions ? O : never) : never;

/** The Better Auth instance a configuration produces, with plugin types intact. */
export type AuthOf<C> = Auth<AuthOptionsOf<C>>;

/**
 * `auth.api` for this configuration — every endpoint, including each plugin's.
 *
 * This is the type that silently collapses when a configuration is annotated
 * rather than `satisfies`-checked, so it is the one worth asserting on.
 */
export type ApiOf<C> = AuthOf<C>["api"];

/** The user model, widened by whichever plugins and `user.additionalFields` apply. */
export type UserOf<C> = AuthOf<C>["$Infer"]["Session"]["user"];

/** The session model, widened the same way. */
export type SessionOf<C> = AuthOf<C>["$Infer"]["Session"]["session"];

/** Better Auth's error codes plus each plugin's, for exhaustive handling. */
export type ErrorCodesOf<C> = AuthOf<C>["$ERROR_CODES"];
