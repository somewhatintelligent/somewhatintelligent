/**
 * THE AMBIENT SPAN SCOPE — and the ONE MODULE IN THIS PACKAGE A BROWSER MUST
 * NEVER REACH.
 *
 * `observe()` opens one span per request at the Worker boundary, which is the
 * most a Worker can see on its own: an SSR render and a server-function call
 * arrive on the same URL and are indistinguishable from out there. Start knows
 * the difference, so the spans worth having are opened from inside the
 * framework — and something has to carry the boundary's scope across the gap
 * between the two. That is what `AsyncLocalStorage` is doing here, and it is
 * the only reason this file imports a Node builtin.
 *
 * WHY IT IS ITS OWN MODULE, and this is the whole point of the file:
 *
 * `app/start.ts` is imported by BOTH bundles, so anything it can reach is
 * compiled for a browser. The compiler does strip a `.server()` body from the
 * client and then runs dead-code elimination — but DCE CANNOT REMOVE AN
 * EXPORTED BINDING. So while `within` and the middleware lived in one module,
 * `export const within` kept `ambient()` alive, which kept
 * `new AsyncLocalStorage()` alive, which kept the `node:async_hooks` import
 * alive. Vite rewrites that import to a property read on its browser-external
 * Proxy, and the read happens at MODULE EVALUATION — so the console threw
 * `Cannot access "node:async_hooks.AsyncLocalStorage" in client code` before
 * React hydrated, and every button on every page was dead.
 *
 * Rollup's cross-module tree-shaking hid it in production builds, because there
 * `within` really is unreachable from the client entry and the whole chain gets
 * dropped. Dev has no such pass. A bug visible only in dev, in the one
 * environment you develop in.
 *
 * The fix is the module boundary rather than a clever deferral: `./index.ts`
 * imports `span` and uses it ONLY inside a `.server()` body, so on the client
 * that body goes, `span` becomes unreferenced, and DCE takes this import with
 * it. Nothing here is exported to a module a browser can load.
 *
 * KEEP THIS OUT OF `../server.ts`. Not for any capability reason — every Worker
 * here runs `nodejs_compat` and any that did not could simply turn it on. It is
 * a layering rule: `../server.ts` is the GENERAL observability entrypoint, used
 * by four Workers across three frameworks, and this bridge exists only to carry
 * a span scope into TanStack Start's request middleware. Framework machinery
 * belongs under the framework subpath, where a consumer that does not use Start
 * never resolves it.
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { AsyncLocalStorage } from "node:async_hooks";

import type { SpanScope } from "../index.ts";

/**
 * Constructed on first use rather than at module scope.
 *
 * This is NOT what keeps the module client-safe — the module boundary above is,
 * and a deferral alone was tried and failed, because Vite reads the imported
 * binding at module init no matter where the value is used. It is here for the
 * ordinary reason: a Worker that never traces a request never builds one.
 */
let store: AsyncLocalStorage<SpanScope> | undefined;
const ambient = (): AsyncLocalStorage<SpanScope> => (store ??= new AsyncLocalStorage<SpanScope>());

/**
 * Pass as `observe(handler, { within })` on a Start app's Worker entry. Without
 * it the tracing middleware finds no scope and every span it opens is a no-op.
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
