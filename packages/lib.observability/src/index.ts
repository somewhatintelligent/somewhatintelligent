/**
 * THE ISOMORPHIC ENTRYPOINT — everything here is safe in a browser, and that is
 * the contract this file is under rather than a happy accident.
 *
 * The package has four entrypoints along two axes, because the two questions
 * are independent and collapsing them is what broke this platform once already:
 *
 *   .                        general      isomorphic   ← you are here
 *   ./server                 general      SERVER ONLY  (alchemy/Telemetry)
 *   ./tanstack-start         framework    isomorphic
 *   ./tanstack-start/server  framework    SERVER ONLY  (node:async_hooks)
 *
 * WHY THE SPLIT IS LOAD-BEARING. `app/start.ts` in a TanStack Start app is
 * imported by BOTH bundles, so anything its middleware can reach is compiled
 * for a browser. When `templatePath` lived beside `observe()`, importing this
 * five-line string helper dragged `alchemy/Telemetry` into the client graph;
 * when the ALS bridge lived beside the middleware, an exported binding kept
 * `node:async_hooks` alive through dead-code elimination and the browser threw
 * `Cannot access "node:async_hooks.AsyncLocalStorage" in client code` before
 * React hydrated. Every button on every page was dead, in dev only, because
 * production tree-shaking hid it.
 *
 * SO: NOTHING IN THIS FILE MAY IMPORT ANYTHING THAT IS NOT ISOMORPHIC. No
 * alchemy, no `node:` builtins, no Workers types. The type-only imports below
 * are erased, which is why `effect/Tracer` and `effect/Context` are allowed to
 * appear at all.
 */
import type * as Context from "effect/Context";
import type * as Tracer from "effect/Tracer";

/** Structural, so this package needs no Workers type dependency of its own. */
export interface Waitable {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Generic in all three parameters so wrapping is signature-transparent. The
 * handlers this wraps do not agree on any of them — Hono's `env` and
 * `executionCtx` are both optional, mezedes' takes a fourth argument its tests
 * inject — and a fixed shape here would reject them on variance rather than on
 * anything real.
 */
export type FetchHandler<Req = Request, Env = unknown, Ctx = Waitable> = (
  request: Req,
  env: Env,
  ctx: Ctx,
) => Response | Promise<Response>;

/** The request's root span, and the telemetry services to run children under. */
export interface SpanScope {
  readonly parent: Tracer.AnySpan;
  readonly context: Context.Context<never>;
}

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
   * child spans passes this to stash the scope somewhere its own middleware can
   * find it; `./tanstack-start/server`'s `within` is the one implementation.
   */
  readonly within?: <A>(scope: SpanScope, body: () => Promise<A>) => Promise<A>;
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
 * both the dashboards and the monitors stop meaning anything.
 *
 * ISOMORPHIC ON PURPOSE. The TanStack Start tracing middleware names its spans
 * with this, and that middleware reaches a browser — see this file's header for
 * what it cost when this function lived next to `observe()`.
 */
export const templatePath = (pathname: string): string =>
  pathname
    .split("/")
    .map((segment) => (VOLATILE.test(segment) ? ":id" : segment))
    .join("/") || "/";
