/**
 * THE REQUEST MIDDLEWARE EVERY START APP REGISTERS — and the half of this
 * package that is allowed to reach a browser.
 *
 * `app/start.ts` is imported by BOTH bundles, so this module is compiled for
 * the client as well as for workerd. Everything below is written on that
 * assumption:
 *
 *  - the only server-side work happens inside a `.server()` body, which the
 *    Start compiler replaces on the client before running dead-code
 *    elimination; and
 *  - `span` is IMPORTED rather than re-exported, so once that body is gone the
 *    import is unreferenced and DCE removes it — taking `./server.ts` and its
 *    `node:async_hooks` dependency out of the client graph entirely.
 *
 * DO NOT RE-EXPORT ANYTHING FROM `./server.ts` HERE. An exported binding is a
 * referenced binding, DCE cannot touch it, and the Node import comes back — see
 * that file's header for what that looked like the last time it happened.
 *
 * TanStack has direct OpenTelemetry support on the roadmap. When it lands this
 * module collapses into whatever they expose. The docs' own examples register a
 * tracer through `@opentelemetry/api`; the exporter on this platform is
 * Effect's, built by alchemy, so spans are opened against that instead.
 * @see https://tanstack.com/start/latest/docs/framework/react/guide/observability
 */
import { createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

/**
 * `../index.ts`, NEVER `../server.ts`. The isomorphic entrypoint is the only
 * one this module may reach: `../server.ts` opens with `alchemy/Telemetry`,
 * which is deploy machinery the repo's lint rule bans from client code by name,
 * and this file is compiled for a browser.
 */
import { templatePath } from "../index.ts";
import { span } from "./server.ts";

/**
 * The CSRF protection Start installs by itself — put back.
 *
 * `createStartHandler.ts` reads
 * `hasStartInstance ? startOptions.requestMiddleware : [defaultCsrfMiddleware]`,
 * so defining a `start.ts` AT ALL replaces the default rather than adding to
 * it. Both apps defined one that returned `{}`, which read as "no options" and
 * silently meant "no CSRF" — and the warning about it is behind
 * `NODE_ENV !== 'production'`, so production never said a word.
 *
 * The filter is the same one Start's own default uses, so this restores
 * exactly what was lost and no more: server-function calls are checked, page
 * requests are not.
 *
 * WHAT IT ACTUALLY ENFORCES, in order — `Sec-Fetch-Site` must be `same-origin`
 * if present; failing that `Origin` must equal the request origin; failing that
 * `Referer` must be same-origin; and a request carrying none of the three is
 * REFUSED, because `allowRequestsWithoutOriginCheck` defaults to false. Every
 * browser sends the first header on a same-origin `fetch`, which is what a
 * server function is, so ordinary use is unaffected. A caller that sends none
 * of them — curl, a script — now gets a 403 on server functions.
 *
 * It cannot reach the identity API. `app/worker.ts` answers `/api/auth/*` from
 * the AUTH binding and returns BEFORE `startEntry.fetch`, so better-auth's
 * bearer, API-key and passkey clients never pass through here at all.
 */
export const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

/**
 * Register on `createStart({ requestMiddleware: [tracingMiddleware] })`.
 *
 * Names spans from the route template, never the raw path: an id in a pathname
 * would otherwise make every request its own operation and nothing would
 * aggregate. Server functions name themselves, which is the whole reason to be
 * in here rather than at the Worker boundary.
 *
 * `span` is called ONLY from inside `.server()`. That is what lets the client
 * build drop it — see this file's header.
 */
export const tracingMiddleware = createMiddleware().server(
  ({ next, request, pathname, handlerType, serverFnMeta }) => {
    /** Once per request: the name and the attribute are the same template. */
    const route = templatePath(pathname);
    return span(
      serverFnMeta === undefined ? `${handlerType} ${route}` : `serverFn ${serverFnMeta.name}`,
      {
        "start.handler_type": handlerType,
        "http.request.method": request.method,
        "http.route": route,
        ...(serverFnMeta === undefined
          ? {}
          : {
              "start.server_fn.name": serverFnMeta.name,
              "code.filepath": serverFnMeta.filename,
            }),
      },
      () => next(),
    );
  },
);
