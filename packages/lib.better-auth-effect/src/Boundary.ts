/**
 * The primitive: one wrapper that turns an Effect-returning function into
 * whatever plain callback Better Auth wants, for ANY callback in its surface.
 *
 * ## Why one wrapper is enough
 *
 * Every injection point in Better Auth is a plain function stored in the options
 * object. They differ in arity (0..3), in whether they are `async`, and in what
 * they return (`void`, a value, `boolean | void | { data }`, `string | false`).
 * The obvious design — one bespoke adapter per shape — does not generalise and
 * leaves the synchronous positions unreachable entirely.
 *
 * One variadic wrapper covers all of them, because TypeScript's contextual
 * typing flows *through* a generic call into the callback argument. Assigning
 * `run.fn((data) => ...)` into a Better Auth position infers `Args` and `A` from
 * that position, then types `data` from `Args`.
 *
 * The evidence, in `prototypes/full-surface`: an enumerator walks the real
 * `BetterAuthOptions` plus every plugin's option type with the TypeScript
 * checker and finds **226 callback positions**; a generator emits one
 * declaration per position assigning this wrapper's output into that position's
 * exact type; **224 typecheck**, with no `as`, no `any`, no `@ts-ignore`. The
 * two that do not are `admin.ac.newRole` and `organization.ac.newRole`, which
 * are generic signatures AND are not injection points — `ac` is the value
 * `createAccessControl()` returns, so Better Auth supplies `newRole`, not you.
 *
 * The control that makes that non-vacuous: the same generated file against
 * `Boundary<never>` produces **226 errors**, one per position. Every position
 * passes *because* the boundary carries the capabilities, and fails the moment
 * it does not:
 *
 *     Type 'Effect<void, never, { readonly _tag: "Mail"; }>' is not assignable
 *     to type 'Effect<void, never, never>'.
 *
 * A service you forgot to provide is rejected at the callback, generically, with
 * no per-callback machinery.
 *
 * ## The two modes
 *
 * `fn` / `fnVoid` run to a Promise. `fnSync` runs synchronously, for the 27
 * enumerated positions Better Auth calls without awaiting —
 * `advanced.database.generateId`, `session.cookieCache.version` in its sync arm,
 * `logger.log`, `username.usernameNormalization` and others. An Effect that
 * suspends cannot be run synchronously, so `fnSync` fails loudly rather than
 * returning a broken value.
 *
 * That constraint is enforced at RUNTIME and not at compile time, deliberately.
 * An earlier design claimed a phantom `SyncEffect` marker could reject an async
 * service at the call site; it cannot. `Effect.map` and the generator form both
 * erase such a marker, i.e. every realistic callback body erases it. See
 * `Contract.ts` for the full note. The runtime backstop does fire, and is proved
 * against a real Better Auth call path.
 *
 * ## Which fiber
 *
 * `Effect.runPromise` starts a fresh fiber on default services, losing the
 * ambient Clock/Tracer/log annotations and — on Cloudflare — the live
 * `ExecutionContext` that `waitUntil` needs. So the boundary always runs against
 * a captured `Context`. Two capture strategies, and the difference is
 * load-bearing:
 *
 *   - {@link makeBoundary} captures at construction. Correct for isolate-scoped
 *     services (Mail, Database) and wrong for anything per-request:
 *     the options object is built once per isolate, so every later request's
 *     callbacks would see the first request's context.
 *   - {@link makeRequestBoundary} reads an `AsyncLocalStorage` populated per
 *     request by {@link enterRequest}. ALS propagates across `await`, so a
 *     callback Better Auth reaches ten awaits deep still finds the right one,
 *     and two concurrent requests in one isolate cannot read each other's.
 *
 * `Effect.context<R>()` is typed `Context<R>` but at runtime carries every
 * service the fiber had — including host services this module cannot name. That
 * is what lets a resource-agnostic package transport Cloudflare's
 * `WorkerExecutionContext` without importing alchemy.
 *
 * This module is SERVER-ONLY: `node:async_hooks` has no browser equivalent.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Cause, Context, Effect, Exit, type Scope } from "effect";

/**
 * A function of any shape whose body is an Effect requiring `R`.
 *
 * `R` is fixed by the boundary, so `yield* Mail` inside a callback compiles when
 * the boundary carries `Mail` and is a type error when it does not.
 */
export interface Boundary<R> {
  /** `(...args) => Promise<A>`. Rejects when the Effect fails. */
  readonly fn: <Args extends readonly unknown[], A, E>(
    body: (...args: Args) => Effect.Effect<A, E, R>,
  ) => (...args: Args) => Promise<A>;

  /**
   * `(...args) => void`. For positions that return nothing and are never
   * awaited, e.g. `advanced.backgroundTasks.handler`. Forks on the captured
   * context so the work is attributed to the right request.
   */
  readonly fnVoid: <Args extends readonly unknown[], A, E>(
    body: (...args: Args) => Effect.Effect<A, E, R>,
  ) => (...args: Args) => void;

  /**
   * `(...args) => A`, run synchronously.
   *
   * 27 of the 226 enumerated Better Auth positions are never awaited. Those go
   * here, and may only use services that answer without async work: `runSyncExit`
   * cannot wait, so a body that suspends throws {@link SuspendedInSyncPosition}
   * on its first call, whichever services it reached for.
   *
   * The parameter is a plain `Effect`, so nothing about that is checked at
   * compile time. It cannot be: a marker type would have to survive the body,
   * and both `Effect.map` and `Effect.gen` return a plain `Effect`.
   */
  readonly fnSync: <Args extends readonly unknown[], A, E>(
    body: (...args: Args) => Effect.Effect<A, E, R>,
  ) => (...args: Args) => A;

  /** Escape hatch: run one Effect on the captured context. */
  readonly run: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
}

/** Thrown when a synchronous position is given an Effect that suspends. */
export class SuspendedInSyncPosition extends Error {
  readonly _tag = "SuspendedInSyncPosition";
  constructor() {
    super(
      "A Better Auth callback that is called synchronously was given an Effect " +
        "that suspends. Sync positions (advanced.database.generateId, " +
        "session.cookieCache.version, logger.log) may only use services that " +
        "answer without async work.",
    );
  }
}

/** Thrown when a request-scoped boundary is used outside a request. */
export class NoRequestInScope extends Error {
  readonly _tag = "NoRequestInScope";
  constructor() {
    super(
      "A Better Auth callback ran outside a request. The host must wrap its " +
        "call to auth.handler in enterRequest(...).",
    );
  }
}

/**
 * Turn a Cause into the thing Better Auth should see.
 *
 * `Cause.squash` yields the representative error, so a `new Error("...")` the
 * caller failed with — including Better Auth's own `APIError`, which is how a
 * hook signals "reject this request with status N" — arrives intact rather than
 * buried in a wrapper nothing can match on.
 */
const squashToThrowable = <E>(cause: Cause.Cause<E>): unknown => {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error ? squashed : new Error(Cause.pretty(cause));
};

const boundaryFrom = <R>(context: () => Context.Context<R>): Boundary<R> => {
  const run = <A, E>(effect: Effect.Effect<A, E, R>): Promise<A> =>
    Effect.runPromiseWith(context())(effect);

  return {
    run,
    fn:
      <Args extends readonly unknown[], A, E>(body: (...args: Args) => Effect.Effect<A, E, R>) =>
      (...args: Args): Promise<A> => {
        // Resolving the context can throw, and Better Auth AWAITS this position,
        // so a sync throw would escape its error handling. Convert to rejection.
        try {
          return run(body(...args));
        } catch (thrown) {
          return Promise.reject(thrown);
        }
      },

    fnVoid:
      <Args extends readonly unknown[], A, E>(body: (...args: Args) => Effect.Effect<A, E, R>) =>
      (...args: Args): void => {
        // A void position cannot reject; fork a loud defect instead of throwing
        // context/body resolution synchronously into Better Auth.
        try {
          Effect.runForkWith(context())(body(...args));
        } catch (thrown) {
          Effect.runFork(Effect.die(thrown));
        }
      },

    fnSync:
      <Args extends readonly unknown[], A, E>(body: (...args: Args) => Effect.Effect<A, E, R>) =>
      (...args: Args): A => {
        const exit = Effect.runSyncExit(
          Effect.provide(body(...args), context()) as Effect.Effect<A, E, never>,
        );
        if (Exit.isSuccess(exit)) return exit.value;
        // Effect 4 reports "ran an async Effect with runSync" as an AsyncFiberError
        // defect: a config error, not a delivery failure, so it gets its own type.
        if (Cause.isAsyncFiberError(Cause.squash(exit.cause))) {
          throw new SuspendedInSyncPosition();
        }
        throw squashToThrowable(exit.cause);
      },
  };
};

/**
 * Capture the ambient context now; every callback closes over it.
 *
 * Yield once inside the config Effect, after the services are resolved.
 * Isolate-scoped. See the module doc for when this is the wrong choice.
 */
export const makeBoundary = <R>(): Effect.Effect<Boundary<R>, never, R> =>
  Effect.map(Effect.context<R>(), (captured) => boundaryFrom(() => captured));

const requestStore = new AsyncLocalStorage<Context.Context<never>>();

/**
 * A boundary that reads the context of the request currently running.
 *
 * Pair with {@link enterRequest}. Use for anything the host supplies per
 * request — on Cloudflare that includes the `ExecutionContext` behind
 * `waitUntil`, which dies if invoked on a fiber that has no live one.
 *
 * ## Why this yields the context it then throws away
 *
 * The captured context is deliberately discarded: resolution happens per
 * request, out of the AsyncLocalStorage, which is the entire point. It is
 * yielded anyway so that `R` lands in the REQUIREMENT CHANNEL.
 *
 * Without that, this was a plain function returning `Boundary<R>`, and `R` was
 * a caller's assertion that nothing checked — `makeRequestBoundary<Mail>()` in
 * a configuration that never provides `Mail` compiled, and the missing
 * capability surfaced as a runtime failure. Proved by measuring
 * `Effect.Services<>` on both forms: the isolate boundary recorded `Mail`, this
 * one recorded `never`.
 *
 * That mattered more than it sounds, because this is the boundary a
 * per-invocation Database must use — so the required path for a request-lived
 * backing was the path with no check on it.
 */
export const makeRequestBoundary = <R>(): Effect.Effect<Boundary<R>, never, R> =>
  Effect.map(Effect.context<R>(), () =>
    boundaryFrom<R>(() => {
      const context = requestStore.getStore();
      if (context === undefined) throw new NoRequestInScope();
      return context as Context.Context<R>;
    }),
  );

/**
 * Run `thunk` with the current fiber's context installed as the request context.
 *
 * Wrap the single call that hands control to Better Auth — `Handler.ts` does
 * this for you. ALS propagates across `await`, so callbacks reached arbitrarily
 * deep inside `auth.handler` find it.
 *
 * ## Why `base` exists, and why omitting it was a false guarantee
 *
 * The request fiber does NOT carry the capability Layer. A host provides
 * capabilities around CONSTRUCTION and hands the runtime a `fetch` value, which
 * is invoked later on a fresh fiber holding only host services — the Worker
 * env, the execution context, the incoming request. Measured: that fiber has no
 * `bae/*` tag on it at all.
 *
 * So a callback built by `makeRequestBoundary<Mail>()` that yields `Mail`
 * compiled, typechecked, was satisfied by the capability set, and then died on
 * the first request with `Service not found`. The requirement channel was
 * proving the configuration COULD have reached `Mail` at build time, which is
 * not the claim anyone needed.
 *
 * `base` is the construction context, merged UNDER the request context so that
 * per-request services win — a live `WorkerExecutionContext` must override the
 * deferred one captured at build, or `waitUntil` dies. `test/request-context.test.ts`
 * holds the control: the same callback through `makeBoundary` always worked,
 * which is what isolates this to the request path.
 */
export const enterRequest = <A>(
  thunk: () => Promise<A>,
  base?: Context.Context<never>,
): Effect.Effect<A, never, never> =>
  Effect.flatMap(Effect.context<never>(), (request) =>
    Effect.promise(() =>
      requestStore.run(base === undefined ? request : Context.merge(base, request), thunk),
    ),
  );

/** True when a request context is installed. Lets a host assert over HTTP. */
export const requestBoundaryInstalled = (): boolean => requestStore.getStore() !== undefined;

// ── The inverse direction: Better Auth hands YOU promise-shaped things. ───────

/**
 * A promise Better Auth handed you rejected.
 *
 * Tagged rather than raw `unknown`: the thing that rejected is foreign code, so
 * its error type is genuinely unknowable, but leaving `unknown` in the failure
 * channel means it merges with every other untyped failure and cannot be matched
 * on. The original is on `reason`.
 */
export class CallFailed extends Error {
  readonly _tag = "CallFailed";
  constructor(readonly reason: unknown) {
    super(
      `CallFailed: a promise from Better Auth rejected: ${
        reason instanceof Error ? reason.message : String(reason)
      }`,
    );
  }
}

/**
 * Lift a method Better Auth handed you into Effect, preserving `this`.
 *
 * Several callbacks receive a context object whose methods return Promises —
 * `GenericEndpointContext`, the middleware `ctx` in `hooks.before/after`, the
 * adapter handed to `databaseHooks`. Calling them from inside an Effect body
 * needs this rather than a bare `await`.
 */
export const call = <A>(thunk: () => Promise<A>): Effect.Effect<A, CallFailed> =>
  Effect.tryPromise({ try: thunk, catch: (reason) => new CallFailed(reason) });

/** `call`, for a method that cannot fail in a way you intend to handle. */
export const callOrDie = <A>(thunk: () => Promise<A>): Effect.Effect<A> => Effect.promise(thunk);

/**
 * `advanced.backgroundTasks.handler`, ready to drop in.
 *
 * ```ts
 * const run = yield* makeRequestBoundary<Mail | Scope.Scope>()
 * // …
 * advanced: { backgroundTasks: { handler: waitUntil(run) } }
 * ```
 *
 * Better Auth hands over an already-running `Promise` and asks that it not be
 * dropped. This hangs it off the REQUEST scope, which is the only place that
 * question has a portable answer: a host closes that scope when the event
 * settles, and what "settles" costs is the host's to decide. Alchemy's Worker
 * bridge closes it into `ctx.waitUntil`, so the work outlives the response; its
 * Lambda bridge settles it before the response leaves, because a frozen
 * execution environment runs deferred work never.
 *
 * `fnVoid` rather than `fnSync`: the position returns `void` and is never
 * awaited, so the registration has to survive the caller returning.
 *
 * Requires `Scope` in the boundary's `R`, which is what makes forgetting to run
 * this on a request path a type error rather than a lost email.
 */
export const waitUntil = <R>(
  run: Boundary<R | Scope.Scope>,
): ((promise: Promise<unknown>) => void) => {
  const register = run.fnVoid(
    (settled: Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: unknown }>) =>
      Effect.addFinalizer(() =>
        Effect.flatMap(
          Effect.promise(() => settled),
          (result) =>
            result.ok
              ? Effect.void
              : Effect.logError("bae: a Better Auth background task rejected", result.reason),
        ),
      ),
  );

  return (promise) => {
    // Attach both arms now: waiting for scope close would leave an already-
    // running Promise's rejection floating as unhandled in the meantime.
    register(
      promise.then(
        () => ({ ok: true as const }),
        (reason: unknown) => ({ ok: false as const, reason }),
      ),
    );
  };
};
