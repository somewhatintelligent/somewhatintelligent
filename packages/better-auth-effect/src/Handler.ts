/**
 * The request entrypoint: a `Request => Effect<Response>` with the request
 * boundary installed around it.
 *
 * `enterRequest` is the whole content of this module and it is not optional.
 * Better Auth reaches an injected callback arbitrarily deep inside
 * `auth.handler` — `sendVerificationEmail` fires during sign-up, several awaits
 * down — and a callback built by {@link makeRequestBoundary} resolves its
 * services from the AsyncLocalStorage this installs. Without it, the very first
 * POST that touches such a callback throws `NoRequestInScope`.
 *
 * It is also what makes per-request services correct rather than merely
 * present. `Effect.context<never>()` is typed as carrying nothing, but at
 * runtime it carries every service the request fiber has — including host
 * objects this package cannot name, such as the live Cloudflare
 * `ExecutionContext` behind `waitUntil`. So the transport works without `bae`
 * importing a deployment framework, and two concurrent requests in one isolate
 * cannot read each other's context.
 *
 * Deliberately shaped as `Request => Effect<Response>` and nothing more. Mapping
 * that onto a particular server — `HttpServerResponse.fromWeb`, a Lambda
 * function URL event, a bare `export default { fetch }` — is the host's job, and
 * doing it here would put a transport dependency in a package whose entire point
 * is not having one.
 */

import type { Auth, BetterAuthOptions } from "better-auth";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { enterRequest } from "./Boundary.ts";
import { makeAuth, type AuthInitFailed, type CachedAuth } from "./Auth.ts";

export interface AuthHandler<O extends BetterAuthOptions, E> {
  /**
   * The memoised instance. Yield it during Layer construction for eager
   * initialisation, or leave it alone for lazy — see `Auth.ts`.
   */
  readonly auth: CachedAuth<O, E>;
  /**
   * Hand one request to Better Auth with the calling fiber's context installed
   * as the request context.
   *
   * A rejection from `auth.handler` arrives as a DEFECT, not a typed failure.
   * That is the honest classification: Better Auth converts an `APIError` into a
   * response itself, so anything that escapes is an unhandled error in a
   * callback rather than a delivery outcome the caller can act on.
   */
  readonly handle: (request: Request) => Effect.Effect<Response, E | AuthInitFailed>;
  /**
   * The same thing as an Effect-native HTTP handler when the server request is
   * backed by a Web `Request`.
   *
   * Every host was writing the identical six lines — take the request, unwrap
   * `.source`, call `handle`, wrap the `Response` back up. That is not a
   * decision anyone makes differently, so it is not worth making anyone write.
   *
   * `HttpServerRequest.fromWeb` and Web-native server implementations have that
   * source. A native Node request or Lambda event does not; the host must first
   * convert it to a `Request` and call {@link AuthHandler.handle}. The runtime
   * guard below keeps such a source from being silently downcast.
   */
  readonly http: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E | AuthInitFailed,
    HttpServerRequest
  >;
}

/**
 * `Effect<AuthHandler<O, E>, never, R>` — the one seam a host mounts.
 *
 * `R` is whatever the configuration required and is discharged by the host.
 * Nothing about the result mentions a capability, a resource, or a platform.
 */
export const makeHandler = <O extends BetterAuthOptions, E, R>(
  options: Effect.Effect<O, E, R>,
): Effect.Effect<AuthHandler<O, E>, never, R> =>
  Effect.gen(function* () {
    // Captured so `enterRequest` can merge it under the request context: the
    // request fiber carries host services only, never the capability Layer.
    const construction = yield* Effect.context<R>();
    const auth = yield* makeAuth(options);

    const handle = (request: Request) =>
      Effect.flatMap(auth, (instance: Auth<O>) =>
        enterRequest(() => instance.handler(request), construction),
      );

    return {
      auth,
      handle,
      http: Effect.flatMap(HttpServerRequest, (request) =>
        request.source instanceof Request
          ? Effect.map(handle(request.source), HttpServerResponse.fromWeb)
          : Effect.die(
              new TypeError(
                "bae: AuthHandler.http requires a Web Request-backed HttpServerRequest; " +
                  "convert the host request and call AuthHandler.handle instead",
              ),
            ),
      ),
    };
  });
