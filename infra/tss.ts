/**
 * TanStack Start's half of the tracing.
 *
 * `observe()` opens one span per request at the Worker boundary, which is the
 * most a Worker can see on its own: an SSR render and a server-function call
 * arrive on the same URL and are indistinguishable from out there. Start knows
 * the difference — `handlerType` and `serverFnMeta` are both on its
 * request-middleware context — so the spans worth having have to be opened from
 * inside the framework.
 *
 * `createStart` is the documented seam for that, and one REQUEST middleware
 * covers both shapes; a separate function middleware would only re-derive what
 * `serverFnMeta` already says.
 * @see https://tanstack.com/start/latest/docs/framework/react/guide/observability
 *
 * TanStack has direct OpenTelemetry support on the roadmap. When it lands this
 * module collapses into whatever they expose — the docs' own examples reach for
 * `@opentelemetry/api`'s global tracer, which is a no-op here: that tracer is
 * registered by a `NodeSDK`, and workerd does not run one. The exporter on this
 * platform is Effect's, built by alchemy, so spans are opened against it.
 *
 * `node:async_hooks` lives here rather than in `observe.ts` deliberately: the
 * Astro site's Worker sets no `nodejs_compat` flag, and a static import there
 * would fail at module load. Both Start apps set it.
 */
import { createMiddleware } from "@tanstack/react-start";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { AsyncLocalStorage } from "node:async_hooks";

import { templatePath, type SpanScope } from "./observe.ts";

/**
 * Constructed on first use, never at module scope.
 *
 * `app/start.ts` is shared by both bundles, so this module reaches the client
 * too, and Vite externalizes `node:async_hooks` there — the stub throws the
 * moment it is touched. Start tree-shakes `.server()` bodies out of the client
 * build, so nothing below ever runs there; a `new AsyncLocalStorage()` at module
 * scope, though, would run during evaluation and take the browser bundle down
 * with it. Deferring the construction is what keeps the import inert.
 */
let store: AsyncLocalStorage<SpanScope> | undefined;
const ambient = (): AsyncLocalStorage<SpanScope> => (store ??= new AsyncLocalStorage<SpanScope>());

/**
 * Pass as `observe(handler, { within })` on a Start app's Worker entry. Without
 * it the middleware below finds no scope and every span here is a no-op.
 */
export const within = <A>(scope: SpanScope, body: () => Promise<A>): Promise<A> =>
  ambient().run(scope, body);

/**
 * Open a child span from promise-land, nested under whatever is already open.
 *
 * A pass-through when nothing is observing, so a unit test or a script that
 * calls an instrumented function does not have to stand telemetry up first.
 */
export const span = async <A>(
  name: string,
  attributes: Record<string, unknown>,
  body: () => A,
): Promise<Awaited<A>> => {
  const scope = ambient().getStore();
  if (scope === undefined) return await body();

  const exit = await Effect.gen(function* () {
    // Re-stash the span we just opened so a nested `span()` parents to it
    // rather than flattening back onto the request root.
    const self = yield* Effect.currentSpan;
    return yield* Effect.promise(
      (): Promise<Awaited<A>> => Promise.resolve(ambient().run({ ...scope, parent: self }, body)),
    );
  }).pipe(
    Effect.withSpan(name, { attributes, parent: scope.parent }),
    Effect.provideContext(scope.context),
    Effect.runPromiseExit,
  );

  if (Exit.isSuccess(exit)) return exit.value;
  /**
   * Rethrow the ORIGINAL error. `Effect.promise` records a rejection as a
   * defect, and squashing the cause hands back the thrown value itself rather
   * than a wrapper — so a caller's `catch` sees exactly what it would have seen
   * without tracing in the way.
   */
  throw Cause.squash(exit.cause);
};

/**
 * Register on `createStart({ requestMiddleware: [tracingMiddleware] })`.
 *
 * Names spans from the route template, never the raw path: an id in a pathname
 * would otherwise make every request its own operation and nothing would
 * aggregate. Server functions name themselves, which is the whole reason to be
 * in here rather than at the Worker boundary.
 */
export const tracingMiddleware = createMiddleware().server(
  ({ next, request, pathname, handlerType, serverFnMeta }) =>
    span(
      serverFnMeta === undefined
        ? `${handlerType} ${templatePath(pathname)}`
        : `serverFn ${serverFnMeta.name}`,
      {
        "start.handler_type": handlerType,
        "http.request.method": request.method,
        "http.route": templatePath(pathname),
        ...(serverFnMeta === undefined
          ? {}
          : {
              "start.server_fn.name": serverFnMeta.name,
              "code.filepath": serverFnMeta.filename,
            }),
      },
      () => next(),
    ),
);
