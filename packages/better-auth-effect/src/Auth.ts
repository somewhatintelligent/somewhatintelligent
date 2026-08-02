/**
 * Configuration Effect in, live Better Auth instance out.
 *
 * ## `O` is generic, and that is not stylistic
 *
 * `betterAuth` is declared
 * `<Options extends BetterAuthOptions>(options: Options & {}) => Auth<Options>`.
 * Every plugin's endpoints, and therefore every method on `auth.api`, is
 * recovered from `Options` by inference. Writing the parameter here as
 * `Effect<BetterAuthOptions, E, R>` instead of `Effect<O, E, R>` collapses
 * `Auth<Options>` to `Auth<BetterAuthOptions>` and silently deletes the entire
 * plugin API surface from the result type.
 *
 * The matching rule on the caller's side is to end the config object with
 * `satisfies BetterAuthOptions` and never `: BetterAuthOptions`. The annotation
 * widens the object literal and throws away exactly the literal types the
 * inference depends on.
 *
 * ## The instance is an Effect, and it is cached
 *
 * `makeAuth` returns a memoised `Effect<Auth<O>, ...>` rather than a built
 * instance, for two independent reasons:
 *
 *  1. **Correctness.** Better Auth's `init` is async, hits the database, and
 *     builds every endpoint. Building it per request would give each request its
 *     own `$context` promise, its own adapter, and its own captured boundary
 *     context. One in-flight build is shared, and its success is retained for
 *     the isolate.
 *
 *  2. **Deploy-time survival.** A `Cloudflare.Worker` impl body runs twice: once
 *     on the deploy host during planning, to discover bindings, and once in the
 *     isolate. During planning there is no Cloudflare env, so a secret is
 *     unreadable and every resource `Output` is an unresolved expression.
 *     Building eagerly fails at deploy with
 *     `Cannot coerce Output<...> to a string`. Deferring to first use does not.
 *
 * ## `$context` is forced inside the build
 *
 * `createBetterAuth` calls `initFn(options)` eagerly and stores the PROMISE.
 * Nothing awaits it until the first request. So a bad database does not throw
 * from `betterAuth(...)` — it produces a rejected promise that surfaces later,
 * as an unhandled rejection if no request ever arrives. Awaiting it as part of
 * the build converts that into an {@link AuthInitFailed} in the error channel.
 * Failed builds are not retained: the next use gets a fresh attempt, so one
 * transient database failure cannot poison the isolate.
 *
 * ## Eager or lazy is the HOST's choice, and both are legitimate
 *
 * This function only gives you the cached Effect. Yield it once during Layer
 * construction and you get eager semantics: a broken database fails the Layer,
 * which is what you want on a long-lived server. Do not, and you get lazy
 * semantics: nothing is built until the first request, which is what you need
 * inside a Worker impl that also runs at deploy time. The distinction is one
 * `yield*` at the call site, so neither is baked in here.
 */

import { betterAuth, type Auth, type BetterAuthOptions } from "better-auth";
import { Effect, Exit, Ref } from "effect";

/** Better Auth could not initialise — almost always the database. */
export class AuthInitFailed extends Error {
  readonly _tag = "AuthInitFailed";
  constructor(readonly reason: unknown) {
    super(
      `AuthInitFailed: Better Auth could not initialise its context: ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
    );
  }
}

/** A built instance, or the reason it could not be built. Memoised by `makeAuth`. */
export type CachedAuth<O extends BetterAuthOptions, E = never> = Effect.Effect<
  Auth<O>,
  E | AuthInitFailed
>;

const build = <O extends BetterAuthOptions, E, R>(
  options: Effect.Effect<O, E, R>,
): Effect.Effect<Auth<O>, E | AuthInitFailed, R> =>
  Effect.gen(function* () {
    const resolved = yield* options;
    const auth = betterAuth(resolved);
    // Force `init` NOW, on this fiber, with a typed failure. See the module doc.
    yield* Effect.tryPromise({
      try: () => auth.$context,
      catch: (reason) => new AuthInitFailed(reason),
    });
    return auth;
  });

/**
 * Build a Better Auth instance from a configuration Effect, once.
 *
 * `R` — every capability the configuration reached for — bubbles into THIS
 * Effect's requirements, where the host discharges it with `Effect.provide`.
 * It does not leak into the returned `CachedAuth`, because the context is
 * captured and provided to the deferred build.
 */
export const makeAuth = <O extends BetterAuthOptions, E, R>(
  options: Effect.Effect<O, E, R>,
): Effect.Effect<CachedAuth<O, E>, never, R> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const source = Effect.provideContext(build(options), context);
    const initial = yield* Effect.cached(source);
    const current = yield* Ref.make(initial);

    const cached = Effect.suspend(() =>
      Effect.flatMap(Ref.get(current), (attempt) =>
        Effect.onExit(attempt, (exit) => {
          if (Exit.isSuccess(exit)) return Effect.void;

          // Replace only the observed attempt: one concurrent caller installs
          // the next single-flight cache and none can clear a newer attempt.
          return Effect.flatMap(Effect.cached(source), (next) =>
            Ref.update(current, (active) => (active === attempt ? next : active)),
          );
        }),
      ),
    );
    return yield* Effect.succeed(cached);
  });
