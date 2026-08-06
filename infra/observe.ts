/**
 * Telemetry for Workers that alchemy does not wrap.
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

/** Structural, so this module needs no Workers type dependency of its own. */
interface Waitable {
  waitUntil(promise: Promise<unknown>): void;
}

export type FetchHandler<Env> = (
  request: Request,
  env: Env,
  ctx: Waitable,
) => Response | Promise<Response>;

export interface ObserveOptions {
  /**
   * Names the span's low-cardinality half. Defaults to {@link templatePath},
   * which is usually enough; pass one when an app knows its real route table
   * and wants the template to say so.
   */
  readonly route?: (request: Request) => string | undefined;
  /**
   * Wraps the handler call with the request's span in hand.
   *
   * The handler is opaque to Effect — it is a promise, so nothing inside it can
   * reach the current span to hang a child off. A framework layer that wants
   * child spans (`./tss.ts`, for TanStack Start) passes this to stash the scope
   * somewhere its own middleware can find it.
   */
  readonly within?: <A>(scope: SpanScope, body: () => Promise<A>) => Promise<A>;
}

/** The request's root span, and the telemetry services to run children under. */
export interface SpanScope {
  readonly parent: Tracer.AnySpan;
  readonly context: Context.Context<never>;
}

/**
 * A path segment that is almost certainly an identifier: digits, a UUID, or
 * any long opaque token. Deliberately conservative — a false positive costs a
 * vaguer span name, a false negative costs an unbounded set of them.
 */
const VOLATILE =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[\w-]{16,})$/i;

/**
 * Collapse identifiers out of a path so spans aggregate.
 *
 * `/media/01J8XK.../thumb` and `/media/01J8XM.../thumb` are the same operation
 * and have to share a name; left raw, every request becomes its own row and
 * both the dashboards and the monitors below stop meaning anything.
 */
export const templatePath = (pathname: string): string =>
  pathname
    .split("/")
    .map((segment) => (VOLATILE.test(segment) ? ":id" : segment))
    .join("/") || "/";

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
export const observe = <Env>(
  handler: FetchHandler<Env>,
  options: ObserveOptions = {},
): FetchHandler<Env> => {
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
    ctx.waitUntil(
      new Promise((resolve) => setTimeout(resolve, 0)).then(() =>
        Effect.runPromise(Scope.close(scope, Exit.void)),
      ),
    );

    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  };
};
