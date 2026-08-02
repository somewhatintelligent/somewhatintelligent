/**
 * `auth.api`, as an Effect-native mirror of itself.
 *
 * `makeHandler` returns `{ auth, handle, http }`. Unwrap `auth` and you have
 * `Auth<O>`, whose `.api` is a record of endpoints returning Promises. Two of
 * the three carry the request boundary; `auth` does not. So the obvious move —
 * yield `auth`, call `instance.api.requestPasswordReset(...)` — reaches
 * `sendResetPassword` on a fiber with no request context, and
 * `test/boundary.test.ts` shows what that costs.
 *
 * ## The mirror is the point
 *
 * A value named `api` must BE `Auth<O>["api"]`, or every call site reads as a
 * wrapper around the thing instead of the thing. {@link EffectApi} is therefore
 * keyed off `Auth<O>["api"]` directly — one entry per endpoint, same name, same
 * arguments, `Effect` where there was a `Promise`. An endpoint this module has
 * never heard of is present because the mapped type cannot omit it, which is the
 * same reason `ba-manifest` reports plugin ids rather than a blessed list.
 *
 * `handle` is NOT here. It is `auth.handler`, not `auth.api`, and a value called
 * `api` carrying the handler is a value that misreads.
 *
 * ## The construction context
 *
 * `enterRequest(thunk, base)` needs `base` — the context the capability Layer
 * was provided against — because the fiber a handler runs on carries host
 * services only (`Boundary.ts` module doc). `makeHandler` captures it privately
 * at `Handler.ts:82` and never exposes it.
 *
 * It does not have to. `Effect.context<R>()` yielded HERE, in the same Effect
 * that calls `makeHandler`, is the same context by construction: both run under
 * the caller's `Effect.provide`. So nothing in this module reaches past `bae`'s
 * public exports, and it lives here rather than in a consumer only because
 * {@link EffectApi} is keyed off `Auth<O>["api"]` — which every auth Worker
 * answering RPC needs, and would otherwise re-derive.
 *
 * ## Failures are values, not defects
 *
 * `enterRequest` returns `Effect.promise(...)`, so a rejection is a DEFECT. That
 * is right for `auth.handler` — Better Auth turns its own `APIError` into a
 * response, so anything escaping is a bug. It is wrong for `auth.api.*`, where
 * the `APIError` IS the answer: `401` for no session, `403` for a failed
 * permission check. A defect crossing a Cloudflare RPC boundary is re-thrown raw
 * (`WorkerBridge.handleRpcExit`), losing the tag; a typed failure is envelope-
 * encoded with every own key preserved (`Rpc.encodeRpcError`).
 *
 * So each call settles its promise to a Result BEFORE it re-enters Effect, and
 * the rejection arm becomes an {@link AuthApiError}. No defect-catching
 * combinator is involved, which also keeps this independent of how Effect
 * spells one.
 */

import type { Auth, BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { Data, Effect } from "effect";
import { enterRequest } from "./Boundary.ts";
import { makeHandler, type AuthHandler } from "./Handler.ts";
import type { AuthInitFailed } from "./Auth.ts";

/**
 * A Better Auth `APIError`, as a value.
 *
 * `status` is the numeric `statusCode` rather than `APIError["status"]`, which
 * is `keyof typeof statusCodes | Status` — a union of the NAME and the number,
 * so a consumer branching on it would have to handle `"FORBIDDEN"` and `403`
 * both. `code` is Better Auth's stable machine-readable string when it supplies
 * one, and `undefined` when it does not; it is never synthesised.
 */
export class AuthApiError extends Data.TaggedError("AuthApiError")<{
  readonly status: number;
  readonly code: string | undefined;
  readonly message: string;
  readonly body: unknown;
}> {}

/** Anything else the call threw — a bug in a callback, not a delivery outcome. */
export class AuthApiDefect extends Data.TaggedError("AuthApiDefect")<{
  readonly message: string;
  readonly reason: unknown;
}> {}

/**
 * `Auth<O>["api"]` with every endpoint returning an Effect.
 *
 * Keyed off the real thing, so the plugin endpoints are present exactly when
 * the plugin is: `listUsers` exists BECAUSE `admin()` is in `plugins`. That is
 * also why the tag over this cannot live in a library — see `Config.ts`.
 */
export type EffectApi<O extends BetterAuthOptions, E = never> = {
  readonly [K in keyof Auth<O>["api"]]: Auth<O>["api"][K] extends (
    ...args: infer Args
  ) => Promise<infer A>
    ? (...args: Args) => Effect.Effect<A, AuthApiError | AuthApiDefect | E | AuthInitFailed>
    : never;
};

/** The Effect-native mirror of the `Auth` instance: its api, and its handler. */
export interface EffectAuth<O extends BetterAuthOptions, E = never> {
  /** `auth.api` — see {@link EffectApi}. */
  readonly api: EffectApi<O, E>;
  /**
   * The escape hatch, for endpoints whose RETURN TYPE depends on their
   * arguments. `EffectApi` maps `(...args) => Promise<infer A>`, and `infer`
   * collapses an argument-dependent return to a single instantiation — so
   * `getSession({ returnHeaders: true })`, which answers `{ headers, response }`
   * instead of the session, types as the session through the mirror.
   *
   * Measured, not anticipated: `Property 'response' does not exist on type
   * '{ session: …; user: … }'`. And it lands on the one method a gateway needs,
   * because `headers.getSetCookie()` is how a rotated cookie reaches the edge.
   *
   * Same boundary, same error mapping; only the typing is manual.
   */
  readonly call: <A>(
    f: (api: Auth<O>["api"]) => Promise<A>,
  ) => Effect.Effect<A, AuthApiError | AuthApiDefect | E | AuthInitFailed>;
  /**
   * `auth.handler` as an Effect-native HTTP handler. **This is what a Worker
   * mounts** — `fetch: Effect.orDie(auth.http)`, which is exactly what
   * `bae-alchemy`'s `authWorker` does. Nothing here adapts anything; `bae`
   * already wrote the six lines (`Handler.ts:93`).
   */
  readonly http: AuthHandler<O, E>["http"];
  /**
   * `auth.handler` in the transport-free `Request => Effect<Response>` shape.
   *
   * Kept because it is what lets this prototype's suite drive the seam with a
   * plain `Request` under `bun test`, with no `HttpServerRequest` and no
   * workerd. A deployment wants {@link EffectAuth.http}.
   */
  readonly handle: AuthHandler<O, E>["handle"];
}

const toFailure = (reason: unknown): AuthApiError | AuthApiDefect => {
  if (reason instanceof APIError) {
    const body = reason.body as { message?: string; code?: string } | undefined;
    return new AuthApiError({
      status: reason.statusCode,
      code: body?.code,
      message: body?.message ?? reason.message,
      body: reason.body,
    });
  }
  return new AuthApiDefect({
    message: reason instanceof Error ? reason.message : String(reason),
    reason,
  });
};

type Settled<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly reason: unknown };

type Endpoint = (...args: ReadonlyArray<unknown>) => Promise<unknown>;

/**
 * Build the mirror from a configuration Effect. One Better Auth instance backs
 * both halves, because `makeHandler` is called once.
 *
 * ## `api` is a Proxy, and has to be
 *
 * The key set is not knowable at construction: `makeAuth` is lazy so a Worker
 * impl body survives running on the deploy host, where there is no Cloudflare
 * env and every binding is an unresolved `Output`. Forcing the instance here to
 * read its keys is the one thing that cannot succeed there.
 *
 * `then` and every symbol are refused rather than forwarded. A `get` trap
 * answering `then` with a function would make this object a THENABLE, and
 * anything that awaits or `Effect.succeed`s it would try to RESOLVE it instead
 * of storing it. Better Auth has no endpoint named `then`; if it ever does, it
 * is unreachable through this mirror and that is the trade.
 */
export const makeEffectAuth = <O extends BetterAuthOptions, E, R>(
  options: Effect.Effect<O, E, R>,
): Effect.Effect<EffectAuth<O, E>, never, R> =>
  Effect.gen(function* () {
    // Captured so `enterRequest` has the context `makeHandler` captured
    // privately; see the module doc. Order is not load-bearing, sameness is.
    const construction = yield* Effect.context<R>();
    const handler = yield* makeHandler(options);

    /** Boundary + error mapping around one already-chosen call. */
    const settle = <A>(run: (instance: Auth<O>) => Promise<A>) =>
      Effect.flatMap(handler.auth, (instance: Auth<O>) =>
        enterRequest<Settled<A>>(
          () =>
            run(instance).then(
              (value): Settled<A> => ({ ok: true, value }),
              (reason: unknown): Settled<A> => ({ ok: false, reason }),
            ),
          construction,
        ),
      ).pipe(
        Effect.flatMap((s) => (s.ok ? Effect.succeed(s.value) : Effect.fail(toFailure(s.reason)))),
      );

    const call = <A>(f: (api: Auth<O>["api"]) => Promise<A>) =>
      settle((instance) => f(instance.api));

    const invoke = (name: string, args: ReadonlyArray<unknown>) =>
      Effect.flatMap(handler.auth, (instance: Auth<O>) => {
        const endpoint = (instance.api as Record<string, unknown>)[name];
        if (typeof endpoint !== "function") {
          return Effect.fail(
            new AuthApiDefect({
              message: `auth.api.${name} is not an endpoint on this configuration`,
              reason: undefined,
            }),
          );
        }
        return enterRequest<Settled<unknown>>(
          () =>
            (endpoint as Endpoint)(...args).then(
              (value): Settled<unknown> => ({ ok: true, value }),
              (reason: unknown): Settled<unknown> => ({ ok: false, reason }),
            ),
          construction,
        );
      }).pipe(
        Effect.flatMap((settled) =>
          settled.ok ? Effect.succeed(settled.value) : Effect.fail(toFailure(settled.reason)),
        ),
      );

    // Refuses `then` and every symbol — see the doc above.
    const api = new Proxy(Object.create(null) as EffectApi<O, E>, {
      get: (_target, property) => {
        if (typeof property !== "string" || property === "then") return undefined;
        return (...args: ReadonlyArray<unknown>) => invoke(property, args);
      },
      has: (_target, property) => typeof property === "string" && property !== "then",
    });

    return { api, call, http: handler.http, handle: handler.handle };
  });
