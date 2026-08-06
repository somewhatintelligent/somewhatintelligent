/**
 * THE SERVER-ONLY GENERAL ENTRYPOINT — telemetry for Workers alchemy does not
 * wrap. A browser must never reach this module.
 *
 * `buildEventTelemetry` — the thing that reads `ALCHEMY_OTEL_EXPORTERS` back
 * and flushes what it buffered — is only ever called by alchemy's own runtime
 * bridges (`WorkerBridge.ts:117`, and the Durable Object / Workflow / Lambda
 * equivalents). A `Website.Vite` ships whatever `main:` points at, and ours
 * export a plain `ExportedHandler`, so nothing on that side reads the bindings.
 * That is the whole reason those Workers stayed dark: binding more env onto
 * them would not have helped, because there was no reader.
 *
 * This is the missing reader, making the same three moves the bridge makes —
 * build the exporter into a per-request scope, run the handler inside it, then
 * close the scope through `waitUntil` so the flush outlives the response.
 *
 * Two services the bridge inherits have to be supplied by hand here:
 * `ConfigProvider` (workerd has no ambient environment, so bound values are
 * unreachable without one over `env`) and `HttpClient` (the OTLP POST itself).
 *
 * IMPORTING `alchemy/Telemetry` IS WHY THIS IS A SEPARATE ENTRYPOINT. It is a
 * legitimate runtime API — the Workers call it correctly and everywhere — but
 * alchemy is also deploy machinery, and the repo's lint rule bans it from
 * client code by name. Anything a browser can reach lives in `../index.ts`.
 */
import { buildEventTelemetry } from "alchemy/Telemetry";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Tracer from "effect/Tracer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { templatePath, type FetchHandler, type ObserveOptions, type Waitable } from "./index.ts";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * Adopt the caller's trace when it sent one. Without this each Worker opens a
 * trace of its own and a request crossing two of them reads as two unrelated
 * traces, which is exactly the view you don't want mid-incident.
 */
const inboundParent = (request: Request): Tracer.AnySpan | undefined => {
  const match = TRACEPARENT.exec(request.headers.get("traceparent") ?? "");
  if (match === null) return undefined;
  const [, traceId, spanId, flags] = match as unknown as [string, string, string, string];
  return Tracer.externalSpan({
    traceId,
    spanId,
    sampled: (Number.parseInt(flags, 16) & 1) === 1,
  });
};

/**
 * OTel HTTP server conventions, minus the query string: it is the one part of
 * a URL that routinely carries tokens and email addresses, and a trace is not
 * the place to keep either.
 */
const attributes = (request: Request, route: string | undefined) => {
  const url = new URL(request.url);
  const agent = request.headers.get("user-agent");
  const colo = (request as { cf?: { colo?: string; country?: string } }).cf;
  return {
    "http.request.method": request.method,
    "url.path": url.pathname,
    "url.scheme": url.protocol.replace(/:$/, ""),
    "server.address": url.host,
    ...(route === undefined ? {} : { "http.route": route }),
    ...(agent === null ? {} : { "user_agent.original": agent }),
    ...(colo?.colo === undefined ? {} : { "cloudflare.colo": colo.colo }),
    ...(colo?.country === undefined ? {} : { "client.country": colo.country }),
  };
};

/**
 * Wrap a plain `fetch` handler so its requests are traced and exported.
 *
 * Behaviour-preserving by construction: the handler's response is returned
 * untouched and a throw is re-thrown, so a telemetry failure can change timing
 * but never the reply. `Effect.promise` treats a rejection as a defect, which
 * is why the exit is squashed back into a throw rather than surfaced.
 */
export const observe = <Req extends Request, Env, Ctx extends Waitable | undefined>(
  handler: FetchHandler<Req, Env, Ctx>,
  options: ObserveOptions = {},
): FetchHandler<Req, Env, Ctx> => {
  return async (request, env, ctx) => {
    const scope = Scope.makeUnsafe();
    const route = (options.route ?? ((r) => templatePath(new URL(r.url).pathname)))(request);
    const parent = inboundParent(request);

    const exit = await Effect.gen(function* () {
      const telemetry = yield* buildEventTelemetry(Context.empty(), scope);
      const run = () => Promise.resolve(handler(request, env, ctx));

      const traced = Effect.gen(function* () {
        const self = yield* Effect.currentSpan;
        return yield* Effect.promise(() =>
          options.within === undefined
            ? run()
            : options.within({ parent: self, context: telemetry }, run),
        );
      }).pipe(
        Effect.tap((response) =>
          Effect.annotateCurrentSpan({ "http.response.status_code": response.status }),
        ),
        Effect.withSpan(route === undefined ? request.method : `${request.method} ${route}`, {
          kind: "server",
          attributes: attributes(request, route),
          ...(parent === undefined ? {} : { parent }),
        }),
      );

      return yield* Effect.provideContext(traced, telemetry);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          FetchHttpClient.layer,
          ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
        ),
      ),
      Effect.runPromiseExit,
    );

    /**
     * The scope owns the exporter's batching fiber and its flush finalizer, so
     * closing it is what actually ships the spans — and it has to happen after
     * the root span ends, which the tracer does in a task scheduled once the
     * handler resolves. One macrotask separates the two, same as the bridge.
     */
    const flush = new Promise((resolve) => setTimeout(resolve, 0)).then(() =>
      Effect.runPromise(Scope.close(scope, Exit.void)),
    );
    /**
     * Without a `waitUntil` — Hono types its execution context as optional, and
     * a direct call in a test has none — the flush is awaited inline instead.
     * Slower, but the alternative is dropping the spans on the floor.
     */
    if (ctx === undefined) await flush;
    else ctx.waitUntil(flush);

    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  };
};
