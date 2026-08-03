/**
 * The tracing seam: one Layer in, one trace out.
 *
 * ```ts
 * const options = Effect.gen(function* () { ... })          // as before
 * const { http } = yield* makeHandler(Effect.map(options, Tracing.withTracing))
 *
 * Effect.provide(Tracing.layerOtlp({ url, headers, serviceName: "auth" }))
 * ```
 *
 * ## Tracing is NOT a capability
 *
 * The seven tags in `Contract.ts` are things a deployment must PROVIDE and that a
 * callback body reaches for by name. A tracer is neither: it is fiber-ambient,
 * every span is opened by machinery rather than by a body, and making it a tag
 * would put `Tracer` in the requirement channel of all 226 callback positions
 * to no end. So it is a `Layer<never>` that sets Effect's own `Tracer`
 * reference, and a deployment that provides nothing gets Effect's no-op tracer
 * and pays approximately nothing.
 *
 * ## Naming: the config path IS the span name
 *
 * `Boundary.fn` cannot name a span. Inside it there is only a function — it does
 * not know whether it is filling `emailAndPassword.sendResetPassword` or
 * `databaseHooks.user.create.after`, so every span it opened would carry the
 * same name, which is worse than no span. The name lives one level up, in the
 * shape of the options object, and that is where {@link withTracing} reads it.
 *
 * Measured, not argued: the tracing prototype ran both designs against the same
 * Better Auth instance and compared the span names that came out.
 *
 * ## What may be wrapped, and why it is an ALLOW-list
 *
 * The obvious implementation walks the options object and wraps every function
 * it finds. That is unsound in two ways, and both are live:
 *
 *   - `options.database` may itself be a function. Better Auth calls it
 *     SYNCHRONOUSLY and expects an `Adapter` back
 *     (`better-auth/dist/db/adapter-base.mjs:14`), which is exactly what
 *     `drizzleAdapter(db, cfg)` returns. A wrapper that returns a Promise breaks
 *     the whole instance at init.
 *   - 27 of the 226 enumerated callback positions are never awaited
 *     (`advanced.database.generateId`, `logger.log`,
 *     `session.cookieCache.version`, ...). Turning those into Promise-returning
 *     functions substitutes `[object Promise]` for a row id.
 *
 * A deny-list gets this backwards: it is silently wrong whenever Better Auth
 * grows a new synchronous option, and the failure is a broken deployment. An
 * allow-list is silently wrong whenever Better Auth grows a new asynchronous
 * callback, and the failure is a missing span. So: {@link CORE_TRACED_PATHS} is
 * the set of core positions the callback enumerator marked
 * `awaitedness: "async"`, minus `session.cookieCache.version`, which has both a
 * sync and an async arm and must therefore be treated as sync.
 *
 * `plugins` is not descended into for a second, independent reason: those are
 * functions Better Auth built, not callbacks you supplied. Instrument a plugin
 * by naming its own option object:
 *
 * ```ts
 * plugins: [twoFactor(withTracing(twoFactorOptions, {
 *   prefix: "bae.twoFactor",
 *   paths: ["otpOptions.sendOTP"],
 * }))]
 * ```
 *
 * ## Which fiber, and which parent
 *
 * A wrapped callback runs through {@link makeRequestBoundary}, i.e. on the
 * request fiber's captured context. That is what makes the span a child of the
 * request span rather than an orphan root, and it is proved with a failing
 * control: running the same body through a bare `Effect.runPromise` produces a
 * span in a brand new trace.
 *
 * The default parent is therefore whatever the request fiber's current span is.
 * On a runtime where Better Auth's own instrumentation is live, its `db ...`
 * span is where the callback ACTUALLY is, and the two disagree about depth —
 * see {@link TracingOptions.parent} for the one-line fix, and the module note
 * below for why it does not arise on Cloudflare.
 *
 * ## Better Auth's own spans, and where they are not
 *
 * Better Auth emits OpenTelemetry spans natively — per endpoint, per hook, and
 * `db {operation} {model}` on every adapter call. They join this trace only if a
 * real `TracerProvider` AND a context manager that survives `await` are
 * registered on the GLOBAL `@opentelemetry/api` singleton, because that is where
 * `trace.getTracer("better-auth")` looks. `@effect/opentelemetry`'s
 * `OtelTracer.layerGlobal` supplies the third requirement (publishing Effect's
 * span into the OTel context) and NEITHER of the first two.
 *
 * On Cloudflare the question does not arise: `@better-auth/core`'s
 * `exports["./instrumentation"]` maps the `workerd` condition to a build whose
 * `withSpan` is `return fn()`, so the instrumentation is compiled out and
 * Better Auth emits zero spans no matter what is registered. Isolated by
 * varying only the resolution condition: `[conditions default]` yields Better
 * Auth's own spans, `[conditions workerd]` yields none, same source.
 *
 * That is why this module has NO OpenTelemetry dependency. `bae` imports
 * `effect`, `better-auth` and `node:async_hooks`, and that is still the whole
 * list. On Workers the OTel bridge would buy nothing; on Node it is four lines
 * in the consumer, and {@link TracingOptions.parent} is the seam for it.
 */

import { Effect, Layer, Option, Tracer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpTraceContext from "effect/unstable/http/HttpTraceContext";
import * as OtlpSerialization from "effect/unstable/observability/OtlpSerialization";
import * as OtlpTracer from "effect/unstable/observability/OtlpTracer";
import { makeRequestBoundary, requestBoundaryInstalled } from "./Boundary.ts";

// ── 1. Which positions may be wrapped ────────────────────────────────────────

/**
 * Core `BetterAuthOptions` callback positions Better Auth AWAITS.
 *
 * Generated from the callback-position enumeration described in the README,
 * which is produced by walking the real types with the TypeScript checker: the
 * 49 core positions whose `awaitedness` is `"async"`, less
 * `session.cookieCache.version` (it is enumerated twice, and its synchronous arm
 * is the one that decides).
 *
 * Not exhaustive over Better Auth forever, and deliberately so — see the module
 * doc. A position missing from here costs a span; a synchronous position wrongly
 * present here costs the deployment.
 */
export const CORE_TRACED_PATHS: ReadonlyArray<string> = [
  "account.accountLinking.trustedProviders",
  "databaseHooks.account.create.after",
  "databaseHooks.account.create.before",
  "databaseHooks.account.delete.after",
  "databaseHooks.account.delete.before",
  "databaseHooks.account.update.after",
  "databaseHooks.account.update.before",
  "databaseHooks.session.create.after",
  "databaseHooks.session.create.before",
  "databaseHooks.session.delete.after",
  "databaseHooks.session.delete.before",
  "databaseHooks.session.update.after",
  "databaseHooks.session.update.before",
  "databaseHooks.user.create.after",
  "databaseHooks.user.create.before",
  "databaseHooks.user.delete.after",
  "databaseHooks.user.delete.before",
  "databaseHooks.user.update.after",
  "databaseHooks.user.update.before",
  "databaseHooks.verification.create.after",
  "databaseHooks.verification.create.before",
  "databaseHooks.verification.delete.after",
  "databaseHooks.verification.delete.before",
  "databaseHooks.verification.update.after",
  "databaseHooks.verification.update.before",
  "emailAndPassword.onExistingUserSignUp",
  "emailAndPassword.onPasswordReset",
  "emailAndPassword.password.hash",
  "emailAndPassword.password.verify",
  "emailAndPassword.sendResetPassword",
  "emailVerification.afterEmailVerification",
  "emailVerification.beforeEmailVerification",
  "emailVerification.sendVerificationEmail",
  "hooks.after",
  "hooks.before",
  "onAPIError.onError",
  "rateLimit.customStorage.consume",
  "rateLimit.customStorage.get",
  "rateLimit.customStorage.set",
  "secondaryStorage.delete",
  "secondaryStorage.increment",
  "trustedOrigins",
  "user.changeEmail.sendChangeEmailConfirmation",
  "user.deleteUser.afterDelete",
  "user.deleteUser.beforeDelete",
  "user.deleteUser.sendDeleteAccountVerification",
  "verification.storeIdentifier.default.hash",
  "verification.storeIdentifier.hash",
];

/**
 * Core positions Better Auth calls WITHOUT awaiting, and `options.database`.
 *
 * Exported as documentation and as the fixture a test asserts disjointness
 * against: nothing here may ever appear in {@link CORE_TRACED_PATHS}.
 *
 * `secondaryStorage.get` / `.set` / `.getAndDelete` are enumerated `"opaque"`
 * (they return `unknown`); Better Auth does await them, but a backing is free to
 * answer synchronously and there is nothing to gain by forcing a microtask onto
 * a session read on every request, so they are left alone. `.delete` and
 * `.increment` are enumerated `"async"` and are traced.
 */
export const CORE_UNTRACEABLE_PATHS: ReadonlyArray<string> = [
  "advanced.backgroundTasks.handler",
  "advanced.database.generateId",
  "database",
  "emailAndPassword.customSyntheticUser",
  "logger.log",
  "secondaryStorage.get",
  "secondaryStorage.getAndDelete",
  "secondaryStorage.set",
  "session.cookieCache.version",
];

// ── 2. The options post-processor ────────────────────────────────────────────

/** An external span to hang a callback's span from, instead of the request's. */
export interface ParentSpanRef {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled?: boolean | undefined;
}

export interface TracingOptions {
  /** Span-name prefix. `bae` by default, so `bae.databaseHooks.user.create.after`. */
  readonly prefix?: string | undefined;
  /**
   * Dotted paths to instrument, relative to the object passed in.
   *
   * Defaults to {@link CORE_TRACED_PATHS}. Supply this when instrumenting a
   * PLUGIN's option object, which has its own positions and its own name.
   */
  readonly paths?: ReadonlyArray<string> | undefined;
  /**
   * Where a callback's span should hang, read at call time.
   *
   * Default (`undefined`) is the request fiber's current span, which is correct
   * on any runtime where Better Auth emits no spans of its own — Cloudflare, for
   * one. Where its instrumentation IS live, its `db create user` span is where
   * the callback actually is, and the request span is one branch too shallow.
   * On Node:
   *
   * ```ts
   * import { trace } from "@opentelemetry/api"
   * withTracing(options, { parent: () => trace.getActiveSpan()?.spanContext() })
   * ```
   *
   * The shape is `@opentelemetry/api`'s `SpanContext` structurally, so nothing
   * here imports it.
   */
  readonly parent?: (() => ParentSpanRef | undefined) | undefined;
  /** Extra attributes on every callback span. */
  readonly attributes?: Record<string, unknown> | undefined;
}

/**
 * `makeRequestBoundary` returns an `Effect` so that `R` lands in the requirement
 * channel — the plain-function form let a caller ASSERT a capability nothing
 * checked. Nothing here needs that check (`R` is `never`: this module resolves
 * no services of its own, it only re-enters the request fiber), and the Effect
 * does no work beyond recording the requirement, so running it synchronously is
 * exact rather than a shortcut.
 */
const requestBoundary = () => Effect.runSync(makeRequestBoundary<never>());

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { then?: unknown }).then === "function";

/**
 * Wrap one already-plain Better Auth callback so its work runs inside a span.
 *
 * Wrapping happens at the Promise level rather than the Effect level, which is
 * what lets it instrument a callback written by hand as well as one that came
 * through `Boundary.fn`. The body is invoked INSIDE `Effect.suspend` so the span
 * is already open when it starts — invoking it first and timing the returned
 * Promise would leave the callback's own spans parented above this one, which is
 * the bug this whole module exists to avoid.
 */
const instrument = (
  fn: (...args: never[]) => unknown,
  spanName: string,
  options: TracingOptions,
): ((...args: never[]) => unknown) => {
  const run = requestBoundary();
  const parentOf = options.parent;

  const wrapped = function (this: unknown, ...args: never[]): unknown {
    // No request in scope: call through untouched rather than orphaning a span.
    if (!requestBoundaryInstalled()) return fn.apply(this, args);

    const ref = parentOf?.();
    return run.run(
      Effect.suspend(() => {
        const result = fn.apply(this, args);
        // An async callback must keep its span open until the Promise settles,
        // or the span closes before the work it is timing.
        return isThenable(result)
          ? Effect.promise(() => Promise.resolve(result))
          : Effect.succeed(result);
      }).pipe(
        Effect.withSpan(
          spanName,
          {
            attributes: { "bae.callback": spanName, ...options.attributes },
            ...(ref === undefined ? {} : { parent: Tracer.externalSpan(ref) }),
          },
          { captureStackTrace: false },
        ),
      ),
    );
  };
  // `.name` shows up in stacks and costs nothing; nothing reads `.length`.
  Object.defineProperty(wrapped, "name", { value: spanName, configurable: true });
  return wrapped;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * Replace the function at `segments` with `wrap(fn)`, cloning only the objects
 * on that path.
 *
 * Returns the root unchanged — same reference — when the path is absent or does
 * not end in a function, so an options object with no instrumentable positions
 * comes back untouched rather than deep-copied.
 */
const rewrite = (
  root: Record<string, unknown>,
  segments: ReadonlyArray<string>,
  wrap: (fn: (...args: never[]) => unknown) => unknown,
): Record<string, unknown> => {
  const [head, ...rest] = segments;
  if (head === undefined) return root;
  const child = root[head];

  if (rest.length === 0) {
    if (typeof child !== "function") return root;
    return { ...root, [head]: wrap(child as (...args: never[]) => unknown) };
  }
  if (!isPlainObject(child)) return root;
  const next = rewrite(child, rest, wrap);
  return next === child ? root : { ...root, [head]: next };
};

/**
 * Name every instrumentable callback in an options object after the config path
 * it fills.
 *
 * Structurally identical output: same keys, same values, same references for
 * everything not on an instrumented path. Inert when no `Tracer` is provided —
 * Effect's default tracer makes `withSpan` a cheap no-op — so this is safe to
 * leave in the configuration whether or not tracing is switched on.
 */
export const withTracing = <T>(options: T, config: TracingOptions = {}): T => {
  if (!isPlainObject(options)) return options;
  const prefix = config.prefix ?? "bae";
  const paths = config.paths ?? CORE_TRACED_PATHS;

  let current: Record<string, unknown> = options;
  for (const path of paths) {
    const segments = path.split(".");
    current = rewrite(current, segments, (fn) => instrument(fn, `${prefix}.${path}`, config));
  }
  return current as T;
};

// ── 3. The request root span ─────────────────────────────────────────────────

/**
 * Continue an upstream trace, if the caller sent one.
 *
 * W3C `traceparent` first, then B3 and X-B3. `None` when the request starts the
 * trace, which is the normal case for a browser hitting an auth endpoint.
 */
export const parentFromRequest = (request: Request): Option.Option<Tracer.ExternalSpan> =>
  HttpTraceContext.fromHeaders(Headers.fromInput(request.headers));

/**
 * Open the request span around an `Effect<Response>`.
 *
 * This is the root of the trace and it is not optional: every span this module
 * opens is a descendant of it, and without it a Worker's callbacks each become
 * their own root. `Handler.makeHandler` deliberately does not do transport, so
 * the host applies this where it mounts the handler:
 *
 * ```ts
 * const { handle } = yield* makeHandler(options)
 * const fetch = (request: Request) => withRequestSpan(request, handle(request))
 * ```
 *
 * `kind: "server"` and the `http.*` attributes are OpenTelemetry semantic
 * conventions, so an OTLP backend renders this as an inbound HTTP span without
 * being told what it is.
 */
export const withRequestSpan = <E, R>(
  request: Request,
  effect: Effect.Effect<Response, E, R>,
  options?: {
    /** Defaults to `POST /api/auth/sign-in/email`. */
    readonly name?: ((request: Request) => string) | undefined;
    readonly attributes?: Record<string, unknown> | undefined;
    /**
     * Start a new trace when the caller propagated none. Default `true`.
     *
     * A span whose parent is not exported is a broken trace, and on Cloudflare
     * that is the DEFAULT situation rather than an edge case: alchemy's Worker
     * bridge opens its own fetch span before any tracer Layer is provided, so
     * inheriting it yields a request span pointing at an id no collector will
     * ever see. Measured — an end-to-end run against a real collector reported
     * `POST /api/auth/sign-up/email ... ORPHAN` until this defaulted to `true`.
     *
     * An incoming `traceparent` always wins over this: a propagated parent IS
     * exported, by whoever propagated it.
     *
     * Set `false` when the host opens its own span on the SAME tracer — an API
     * Worker that traces its own routes — and wants auth nested inside it.
     */
    readonly root?: boolean | undefined;
  },
): Effect.Effect<Response, E, R> =>
  Effect.suspend(() => {
    const url = new URL(request.url);
    const name = options?.name?.(request) ?? `${request.method} ${url.pathname}`;
    const parent = parentFromRequest(request);
    const root = Option.isNone(parent) && (options?.root ?? true);
    return effect.pipe(
      Effect.tap((response) =>
        Effect.annotateCurrentSpan("http.response.status_code", response.status),
      ),
      Effect.withSpan(name, {
        kind: "server",
        parent: Option.getOrUndefined(parent),
        root,
        attributes: {
          "http.request.method": request.method,
          "url.path": url.pathname,
          "url.scheme": url.protocol.replace(":", ""),
          "server.address": url.host,
          ...options?.attributes,
        },
      }),
    );
  });

// ── 4. The destination ───────────────────────────────────────────────────────

export interface OtlpOptions {
  /** Full traces endpoint, e.g. `https://api.axiom.co/v1/traces`. */
  readonly url: string;
  /** `Authorization`, `X-Axiom-Dataset`, whatever the backend wants. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /**
   * `service.name` on every span. Defaults to {@link DEFAULT_SERVICE_NAME}.
   *
   * Not merely a nicety: Effect's `OtlpResource.fromConfig` FAILS the Layer with
   * a `ConfigError` when it can find no service name anywhere, so a deployment
   * that forgot to set one would die at build rather than trace anonymously.
   * Note also that `OTEL_SERVICE_NAME`, if set, WINS over this — the environment
   * is checked first (`OtlpResource.ts:98-102`), which is the opposite of the
   * usual precedence and is worth knowing before you debug it.
   */
  readonly serviceName?: string | undefined;
  readonly serviceVersion?: string | undefined;
  readonly attributes?: Record<string, unknown> | undefined;
  /**
   * How long the exporter waits before posting a partial batch.
   *
   * The default of 5s is a server default and is WRONG inside a Cloudflare
   * isolate, which is not guaranteed to be alive 5 seconds after it answers. See
   * {@link layerOtlpWorker}.
   */
  readonly exportInterval?: `${number} ${"millis" | "seconds"}` | undefined;
  /** Spans buffered before an export is forked. */
  readonly maxBatchSize?: number | undefined;
  /**
   * The `fetch` the exporter posts with. Defaults to the runtime's.
   *
   * Effect's fetch client reads this from a `Context.Reference` per request
   * (`FetchHttpClient.ts:53`), so overriding it is supported rather than a
   * monkey-patch. Three real reasons to:
   *
   *   - a Worker whose collector is reached through a **Service binding**.
   *     Cloudflare rejects a Worker subrequest to any `*.workers.dev` hostname
   *     with edge error 1042, so a Worker-hosted collector is only reachable
   *     that way. (A hosted OTLP endpoint is not on `workers.dev`, so this does
   *     not apply to Axiom or any normal destination.)
   *   - an egress proxy or mTLS client.
   *   - capturing the exact payload in a test.
   */
  readonly fetch?: FetchLike | undefined;
}

/**
 * The part of `fetch` this module uses.
 *
 * Structural rather than `typeof globalThis.fetch` on purpose: that type is the
 * RUNTIME's, and the runtimes disagree — bun's carries a `preconnect` property,
 * Cloudflare's `Fetcher.fetch` does not, and a Worker handing its Service
 * binding straight in would fail to typecheck against either. This is the
 * intersection everything can satisfy.
 */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * A `Tracer` that posts OTLP/HTTP JSON to `url`.
 *
 * `Layer<never>` — providing it adds nothing to anyone's requirement channel;
 * it sets Effect's `Tracer` reference for the fibers underneath. Not providing
 * it leaves the default no-op tracer in place, which is what "tracing is off"
 * means here.
 *
 * OTLP/HTTP **JSON** rather than protobuf, on purpose: `fetch` is the only
 * transport a Worker has, JSON needs no encoder, and every OTLP collector worth
 * the name accepts `content-type: application/json` on `/v1/traces`. Switch to
 * `OtlpSerialization.layerProtobuf` by composing `layer` yourself if a backend
 * insists.
 */
export const DEFAULT_SERVICE_NAME = "bae";

/**
 * `provideMerge` so `Fetch` is visible both to the client's build and to the
 * exporter's forked fiber.
 *
 * Effect's fetch client resolves its `fetch` with `fiber.getRef(Fetch)` at
 * REQUEST time (`FetchHttpClient.ts:53`), while the fiber doing the posting is
 * forked from the context the exporter's Layer was BUILT with
 * (`OtlpExporter.ts`: `Effect.runForkWith(services)`). `Layer.provide` alone was
 * measured to work — `HttpClient.layerMergedContext` carries the build context
 * through — so this is not a fix for a bug; it removes a dependence on that
 * detail. Both forms were run against a capturing `fetch`.
 *
 * What IS worth knowing is the failure mode when the override does not take:
 * the exporter catches transport errors into `Effect.logDebug` and then disables
 * itself for 60 seconds, so a misrouted exporter reports nothing anywhere and
 * the deployment looks healthy while emitting no spans at all.
 */
const httpLayer = (custom: FetchLike | undefined) =>
  custom === undefined
    ? FetchHttpClient.layer
    : Layer.provideMerge(
        FetchHttpClient.layer,
        Layer.succeed(FetchHttpClient.Fetch, custom as typeof globalThis.fetch),
      );

export const layerOtlp = (options: OtlpOptions): Layer.Layer<never> =>
  OtlpTracer.layer({
    url: options.url,
    headers: options.headers,
    resource: {
      serviceName: options.serviceName ?? DEFAULT_SERVICE_NAME,
      serviceVersion: options.serviceVersion,
      attributes: options.attributes,
    },
    exportInterval: options.exportInterval,
    maxBatchSize: options.maxBatchSize,
  }).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(httpLayer(options.fetch)));

/**
 * {@link layerOtlp} tuned so the export happens INSIDE the request.
 *
 * ## PROVIDE THIS PER REQUEST, not once per isolate
 *
 * That instruction is the whole module in one line, and it is the opposite of
 * what "build your Layers once" would tell you.
 *
 * Effect's OTLP exporter has three ways to post: a forked loop that sleeps
 * `exportInterval` between attempts, an early fork once `maxBatchSize` spans
 * have accumulated, and a **Scope finalizer** that flushes whatever is left
 * (`OtlpExporter.ts`). The first two are bets that the isolate is still running
 * after it has answered, and Cloudflare makes no such promise — nothing forces
 * a Worker to keep executing once the response is out, and there is no
 * `waitUntil` anywhere in this path to hold it open.
 *
 * The finalizer is not a bet. `Effect.provide(layer)` does not complete until
 * its Scope has closed, so if the tracer Layer's scope IS the request, the POST
 * is part of the request and the response waits for it. Measured, at completion,
 * with nothing awaited afterwards:
 *
 * ```
 * maxBatchSize=1/1ms         at completion: {"spans":3,"posts":3}
 * defaults(1000/5s)          at completion: {"spans":3,"posts":1}
 * maxBatchSize=100000/60s    at completion: {"spans":3,"posts":1}
 * ```
 *
 * So the settings here push everything onto the finalizer: an interval long
 * enough never to fire inside a request, and a batch ceiling high enough never
 * to be reached by one. The result is exactly one POST per request, issued
 * before the response is returned, at the cost of that request waiting for it.
 *
 * If the isolate-scoped shape is what you want instead, the host must arrange a
 * real `waitUntil` around exporter shutdown. This layer does not own that host
 * lifecycle seam.
 */
export const layerOtlpWorker = (options: OtlpOptions): Layer.Layer<never> =>
  layerOtlp({
    exportInterval: "60 seconds",
    maxBatchSize: 100_000,
    ...options,
  });

/**
 * The same thing from the standard OpenTelemetry environment variables.
 *
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (or `OTEL_EXPORTER_OTLP_ENDPOINT`),
 * `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SDK_DISABLED`. Absent or disabled yields
 * `Layer.empty`, i.e. the no-op tracer, which is the behaviour you want from a
 * deployment that has not been given a destination yet.
 *
 * A host that sets exactly these names on the Worker's env makes wiring a
 * destination a stack-file change rather than a code change.
 */
export const layerOtlpFromEnv = (options?: {
  readonly serviceName?: string | undefined;
  readonly serviceVersion?: string | undefined;
  readonly attributes?: Record<string, unknown> | undefined;
  readonly fetch?: FetchLike | undefined;
}): Layer.Layer<never> =>
  OtlpTracer.layerFromConfig({
    resource: {
      serviceName: options?.serviceName ?? DEFAULT_SERVICE_NAME,
      serviceVersion: options?.serviceVersion,
      attributes: options?.attributes,
    },
  }).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(httpLayer(options?.fetch)));
