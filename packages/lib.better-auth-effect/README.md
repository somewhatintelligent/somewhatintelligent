# bae — better-auth-effect

Better Auth's **entire** configuration surface, written as Effect code against
service tags, with no knowledge of what backs any of them.

```ts
// The configuration. Capabilities in, options out — see api/config.ts.
export const authConfig = Effect.gen(function* () {
  const bae = yield* Bae;
  const run = yield* makeRequestBoundary<never>();
  const deliver = deliverWith(yield* Mail, yield* EmailTemplates, origin);

  return yield* bae.configure({
    secret,
    baseURL: origin,
    plugins: [username(), admin(), twoFactor()],
    emailAndPassword: {
      enabled: true,
      sendResetPassword: run.fn(({ user, url }) =>
        // `user` and `url` are INFERRED from the position being filled
        deliver("reset-password", user.email, { url }),
      ),
    },
  });
});

// The mount. One instance, its api and its handler, both Effect-native.
const auth = yield * makeEffectAuth(authConfig);
return { ...rpcMethods(auth), fetch: Effect.orDie(auth.http) };
```

Nobody declares the dependency list; `R` **is** the set of tags the body reached
for. Discharging it is the host's job — `Effect.provide(live)` — and forgetting
one is a type error at the callback that needed it:

```
Type 'Effect<void, never, { readonly _tag: "Mail"; }>' is not assignable to
type 'Effect<void, never, never>'.
```

Server-only. `Boundary.ts` needs `node:async_hooks`.

```sh
bun test                              # 41 pass across 6 files
bun run typecheck
bun run scripts/check-purity.ts       # the import gate, with its own control
```

The live consumer is `apps/platform.auth/api/` — `config.ts` writes the options,
`capabilities.ts` and `inert.ts` back the tags for the runtime and the deploy
host respectively, and `worker.ts` mounts the result.

---

## The modules

Everything is re-exported from the package root; the file names are where the
reasoning lives, not an import path you have to spell.

| Module           | What it is                                                          |
| ---------------- | ------------------------------------------------------------------- |
| `Contract.ts`    | the seven capability tags a configuration can reach for             |
| `Boundary.ts`    | the primitive — Effect code into any Better Auth callback           |
| `Base.ts`        | `Bae.configure` — your options, with what the capabilities supply   |
| `ConfigError.ts` | the two combinations `configure` refuses                            |
| `Auth.ts`        | config Effect → memoised `Auth<O>`, with a typed init failure       |
| `Handler.ts`     | `Request => Effect<Response>`, with the request boundary installed  |
| `Api.ts`         | `auth.api` mirrored into Effect, with `APIError` as a value         |
| `Types.ts`       | `UserOf`, `SessionOf`, `ApiOf` — the types a config already implies |
| `Tracing.ts`     | spans named by config path, and an OTLP `Layer<never>`              |

---

# What can be injected

## The seven capability tags

Every one is a `Context.Service`. A configuration that yields one accumulates it
in `R`; the host discharges it with a Layer. `Capabilities` is the union of all
seven, for a host that wants to name the whole set.

Each tag `X` exports its shape as `XService` — `DatabaseService`, `MailService`,
`EmailTemplatesService`, `SmsService`, `SecondaryStoreService`,
`RateLimitStorageService`, `CaptchaService` — which is what a backing annotates
its implementation with before handing it to `Layer.effect(X, …)`.

### Providing one

Two shapes, and which you need is decided by whether building the backing does
any work. `X.of(…)` is the constructor every tag carries; it is an identity
function that fixes the type, so a missing member is an error here rather than at
the call site.

```ts
// Nothing to resolve — a credential you already hold.
const CaptchaLive = Layer.succeed(Captcha, Captcha.of({ … }));

// Something to resolve — a binding, a pool, a client.
const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const d1 = yield* /* however your host reaches the binding */;
    return Database.of({ dialect: "sqlite", betterAuthDatabase: drizzleAdapter(…) });
  }),
);
```

They are provided to **the configuration**, wherever you build it — the tags are
in `authConfig`'s `R`, and `makeEffectAuth` passes `R` straight through:

```ts
Effect.gen(function* () {
  const auth = yield* makeEffectAuth(authConfig);
  return { fetch: Effect.orDie(auth.http) };
}).pipe(Effect.provide(Layer.mergeAll(DatabaseLive, MailLive, CaptchaLive)));
```

Everything below gives the concrete wiring per tag.

### `Database` — `"bae/Database"`, always required

`Bae` yields it unconditionally, so every configuration requires it.

| Member               | Type                                                                |
| -------------------- | ------------------------------------------------------------------- |
| `dialect`            | `SqlDialect` = `"sqlite" \| "postgres" \| "mysql" \| "mssql"`       |
| `betterAuthDatabase` | `BetterAuthDatabase` = `NonNullable<BetterAuthOptions["database"]>` |

`dialect` drives schema generation and migration; `betterAuthDatabase` is the
value handed to `betterAuth({ database })` — **resolved, never a coloured
Effect**. A backing needing per-invocation resolution supplies a façade whose
methods resolve lazily.

```ts
const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const d1 = yield* /* your host's D1 binding */;
    return Database.of({
      dialect: "sqlite",
      // Through an adapter, not the bare handle: a bare binding makes Better
      // Auth use its built-in Kysely adapter, which names columns camelCase.
      // If your migrations are snake_case, every query fails at runtime with
      // `table verification has no column named expiresAt`.
      betterAuthDatabase: drizzleAdapter(drizzle(d1, { relations }), {
        provider: "sqlite",
        schema,
      }),
    });
  }),
);
```

### `Mail` — `"bae/Mail"`, required only if a callback yields it

| Member | Type                                                |
| ------ | --------------------------------------------------- |
| `send` | `(message: MailMessage) => Effect<void, MailError>` |

`MailMessage` is `{ to: readonly string[]; subject; text; html?; headers? }`.
`MailError` is a plain tagged `Error`.

```ts
const MailLive = Layer.effect(
  Mail,
  Effect.gen(function* () {
    const client = yield* /* your transport */;
    return Mail.of({
      // `MailError`, not a defect: a refused send is a failure the caller can
      // answer, and Better Auth turns it into an API error the person sees
      // rather than a 500 that tells them nothing.
      send: (message) =>
        Effect.tryPromise({
          try: () => client.send({ from: FROM, ...message }),
          catch: (reason) => new MailError(String(reason)),
        }).pipe(Effect.asVoid),
    });
  }),
);
```

`from` is yours, not the contract's — `MailMessage` carries no sender, because
which address a deployment is allowed to send as is a property of the transport.

### `EmailTemplates` — `"bae/EmailTemplates"`

| Member   | Type                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------ |
| `render` | `(input: { touchpoint: Touchpoint; variables: Record<string, string> }) => Effect<RenderedMail>` |

`RenderedMail` is `{ subject; text; html }`. Separate from `Mail` deliberately:
ten sender callbacks exist across core and plugins, two of them are SMS, and
`twoFactor.otpOptions.sendOTP` supplies `{ user, otp }` with no channel at all —
so rendering keys on a touchpoint and the caller picks the transport.

`Touchpoint` is the closed set of places Better Auth asks you to deliver
something to a human:

```
reset-password  verify-email  magic-link  email-otp  change-email
delete-account  organization-invitation  two-factor-otp  phone-otp
```

```ts
const EmailTemplatesLive = Layer.succeed(
  EmailTemplates,
  EmailTemplates.of({
    // Total over `Touchpoint` — a `switch` with no default is how a new
    // touchpoint becomes a type error rather than a blank email.
    render: ({ touchpoint, variables }) => Effect.succeed(templateFor(touchpoint)(variables)),
  }),
);
```

`render` cannot fail: a broken template is a defect, not a delivery outcome, and
there is nothing a caller could do with it. `variables` is `Record<string,
string>` because the set differs per touchpoint — a sender callback passes what
that position gave it (`url`, `otp`, `email`, `expiresIn`, …).

The two tags compose in your own helper rather than in `bae`, because which
touchpoint uses which channel is a deployment's decision:

```ts
const deliverWith =
  (mail: MailService, templates: EmailTemplatesService) =>
  (touchpoint: Touchpoint, to: string, variables: Record<string, string>) =>
    Effect.flatMap(templates.render({ touchpoint, variables }), (rendered) =>
      mail.send({ to: [to], ...rendered }),
    );
```

### `Sms` — `"bae/Sms"`

| Member | Type                                                    |
| ------ | ------------------------------------------------------- |
| `send` | `(to: string, body: string) => Effect<void, MailError>` |

```ts
const SmsLive = Layer.succeed(
  Sms,
  Sms.of({
    send: (to, body) =>
      Effect.tryPromise({
        try: () => twilio.messages.create({ to, from: SENDER, body }),
        catch: (reason) => new MailError(String(reason)),
      }).pipe(Effect.asVoid),
  }),
);
```

`MailError` rather than an `SmsError` of its own: the two channels fail the same
way from a callback's point of view, and a second error type would have to be
handled identically everywhere. It is reached by `phoneNumber.sendOTP` and
`twoFactor.otpOptions.sendOTP` — both of which you fill through a boundary like
any other position; nothing wires them for you.

### `SecondaryStore` — `"bae/SecondaryStore"`, optional

Fills `secondaryStorage`. Read with `Effect.serviceOption`, so it never enters
`R`.

| Member         | Type                                        |          |
| -------------- | ------------------------------------------- | -------- |
| `get`          | `(key) => Effect<string \| null>`           | required |
| `set`          | `(key, value, ttlSeconds?) => Effect<void>` | required |
| `delete`       | `(key) => Effect<void>`                     | required |
| `getAndDelete` | `(key) => Effect<string \| null>`           | optional |
| `increment`    | `(key, ttlSeconds) => Effect<number>`       | optional |

The two optional members exist so a substrate can **claim** atomicity rather than
have it assumed. Cloudflare KV implements neither; DynamoDB implements both. The
key set is mirrored rather than filled in, because Better Auth branches on
whether the method is there — **so omit what your substrate cannot do.** A stub
that reads-then-deletes in two round trips satisfies the type and lies about
atomicity, and Better Auth will have taken the atomic path on the strength of it.

Over Cloudflare KV, which has neither:

```ts
const SecondaryStoreLive = Layer.effect(
  SecondaryStore,
  Effect.gen(function* () {
    const kv = yield* /* your KV binding */;
    return SecondaryStore.of({
      get: (key) => Effect.promise(() => kv.get(key)),
      set: (key, value, ttlSeconds) =>
        Effect.promise(() =>
          // KV's floor is 60s; a shorter TTL is rejected, not rounded.
          kv.put(key, value, ttlSeconds === undefined ? {} : { expirationTtl: ttlSeconds }),
        ).pipe(Effect.asVoid),
      delete: (key) => Effect.promise(() => kv.delete(key)).pipe(Effect.asVoid),
      // `getAndDelete` and `increment` deliberately absent — see above.
    });
  }),
);
```

Then just add it to the Layer you provide. Nothing in `authConfig` changes:
`secondaryStorage` is filled by `configure`, and the key is always present and
set to `undefined` when the capability is absent, because Better Auth cannot
distinguish `secondaryStorage: undefined` from an omitted key.

**Providing it changes your schema.** Sessions move out of the database, so
Better Auth stops generating the `session` and `verification` tables. Whatever
generates your schema must therefore resolve the config against the _same_
capability set the Worker gets — that is what a separate inert Layer set
(`api/inert.ts` here) exists for. A missing Layer on one side and not the other
changes the tables and raises no error.

### `RateLimitStorage` — `"bae/RateLimitStorage"`, optional

Fills `rateLimit.customStorage`.

| Member    | Type                                                                              |          |
| --------- | --------------------------------------------------------------------------------- | -------- |
| `get`     | `(key) => Effect<RateLimitRow \| null>`                                           | required |
| `set`     | `(key, value: RateLimitRow, update?) => Effect<void>`                             | required |
| `consume` | `(key, rule: { window; max }) => Effect<{ allowed; retryAfter: number \| null }>` | optional |

`RateLimitRow` is `{ key; count; lastRequest }`. Absent `consume` means Better
Auth takes its documented non-atomic fallback.

```ts
const RateLimitStorageLive = Layer.effect(
  RateLimitStorage,
  Effect.gen(function* () {
    const table = yield* /* your store */;
    return RateLimitStorage.of({
      get: (key) => /* Effect<RateLimitRow | null> */,
      set: (key, value, update) => /* Effect<void> */,
      // Supply `consume` ONLY if the substrate can decide-and-write in one
      // operation — a DynamoDB conditional UpdateItem, a Redis script, a DO.
      consume: (key, rule) =>
        Effect.map(table.increment(key, rule.window), (count) => ({
          allowed: count <= rule.max,
          retryAfter: count <= rule.max ? null : rule.window,
        })),
    });
  }),
);
```

Providing this tag while also setting `rateLimit.storage` yourself is a
`RateLimitStorageConflict` — two answers to where the state lives. Everything
else about `rateLimit` stays yours:

```ts
bae.configure({
  rateLimit: { enabled: true, window: 60, max: 100, customRules: { … } },
  //          ^ policy, yours.   `customStorage` is the capability's and is
  //            not in `BaeOptions` at all.
})
```

### `Captcha` — `"bae/Captcha"`, optional

Providing it wires Better Auth's `captcha()` plugin; you never pass the plugin
yourself, and doing so is a `CapabilityPluginConflict`.

| Member      | Type                                                                         |          |
| ----------- | ---------------------------------------------------------------------------- | -------- |
| `provider`  | `"cloudflare-turnstile" \| "google-recaptcha" \| "hcaptcha" \| "captchafox"` | required |
| `secretKey` | `string`                                                                     | required |
| `endpoints` | `readonly string[]`                                                          | optional |

No async work, so `Layer.succeed` is enough:

```ts
const CaptchaLive = Layer.succeed(
  Captcha,
  Captcha.of({
    provider: "cloudflare-turnstile",
    secretKey: TURNSTILE_SECRET_KEY,
    endpoints: [
      "/sign-up/email",
      "/sign-in/email",
      "/request-password-reset",
      "/sign-in/magic-link", // not covered by the default
      "/two-factor/send-otp",
    ],
  }),
);
```

`endpoints` **replaces** the default list, it does not extend it — Better Auth
takes `options.endpoints?.length ? options.endpoints : defaultEndpoints`. So the
first three above are not decoration; naming only `/sign-in/magic-link` would
silently unprotect email sign-up. The default is `/sign-up/email`,
`/sign-in/email` and `/request-password-reset`, which means a deployment whose
real exposure is a magic-link or OTP flow is unprotected until it says so here.
Paths are relative to `basePath`.

That is the whole server side. `secretKey` is the _secret_, never the site key —
the site key belongs to the widget in the browser, and the client is expected to
send the token as an `x-captcha-response` header on the protected requests.

Never pass `captcha()` in `plugins` as well; `configure` refuses that with a
`CapabilityPluginConflict` rather than wiring two challenge checks. Providing the
tag adds three `$ERROR_CODES` and nothing else — no models, no endpoints — which
is why the plugin is absent from `configure`'s return _type_ while present in its
value.

### Optional capabilities change your schema

The three read with `serviceOption` never enter `R`, so not providing one is a
legitimate deployment choice rather than a mistake. But providing
`SecondaryStore` **removes** the `session` and `verification` tables from what
Better Auth generates. Deploy-time schema generation therefore has to see the
same capability set the Worker does — which is what a separate inert Layer set
(`api/inert.ts` here) exists for.

## The callback boundary

`makeBoundary<R>()` captures the ambient context once — correct for
isolate-scoped services, wrong for anything per-request, because the options
object is built once per isolate and every later request would see the first
one's context. `makeRequestBoundary<R>()` reads the context of the request
currently running out of an `AsyncLocalStorage`, which propagates across `await`,
so a callback Better Auth reaches ten awaits deep still finds the right one.

Both return `Effect<Boundary<R>, never, R>` — yielded, not called, so that `R`
lands in the requirement channel. A plain function returning `Boundary<R>` let a
caller **assert** a capability that nothing checked.

`Boundary<R>` is four members, one per callback shape:

| Member   | Produces                        | For                                                                                   |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------- |
| `fn`     | `(...args) => Promise<A>`       | the 192 awaited positions. Rejects when the Effect fails                              |
| `fnVoid` | `(...args) => void`             | positions that return nothing and are never awaited; forks on the captured context    |
| `fnSync` | `(...args) => A`                | the 27 positions never awaited. Throws `SuspendedInSyncPosition` if the body suspends |
| `run`    | `Effect<A, E, R> => Promise<A>` | the escape hatch                                                                      |

Around them:

| Export                       | What it is                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `enterRequest(thunk, base?)` | installs the request context. `base` is merged **under** it so per-request services win |
| `requestBoundaryInstalled()` | `boolean` — lets a host assert over HTTP that the boundary is live                      |
| `call(thunk)`                | a Promise Better Auth handed _you_, lifted; fails with `CallFailed`                     |
| `callOrDie(thunk)`           | the same for a call you do not intend to handle                                         |
| `waitUntil(run)`             | `advanced.backgroundTasks.handler`, ready to drop in                                    |
| `SuspendedInSyncPosition`    | thrown when a sync position is given a suspending Effect                                |
| `NoRequestInScope`           | thrown when a request-scoped boundary is used outside a request                         |
| `CallFailed`                 | carries the original rejection on `.reason`                                             |

`waitUntil` requires `Scope` in the boundary's `R` — `makeRequestBoundary<Mail |
Scope.Scope>()` — which is what makes forgetting to run it on a request path a
type error rather than a lost email. It hangs the promise off the request scope,
because that is the only place "don't drop this" has a portable answer.

---

# What can be configured

## `Bae.configure`

`Bae` is an `Effect<Bae, never, Database>` — yield it like a tag. It gives you
one method:

```ts
configure: <O extends BaeOptions>(options: O) => Effect<O & BaeSupplied, BaeConfigError>;
```

**`BaeOptions`** is every Better Auth option except the ones a capability
supplies outright: `Omit<BetterAuthOptions, "database" | "secondaryStorage" |
"rateLimit">`, plus `rateLimit` back without `customStorage`. Passing one of the
removed keys is a compile error rather than a silent override. `rateLimit`'s
`enabled`, `window`, `max`, `customRules` and `storage` are policy and stay
yours; only where the state lives is the capability's.

**`BaeSupplied`** is what it fills in: `database`, `secondaryStorage`,
`rateLimit`.

**`baseURL`, `trustedOrigins` and `secret` are deliberately not capabilities.**
They are ordinary deployment values with established practices, and a tag
supplying them would narrow what a deployment could express.

What merges, and which side wins:

| key                       | rule                                 |
| ------------------------- | ------------------------------------ |
| `plugins`                 | capability plugins first, then yours |
| `rateLimit.customStorage` | `RateLimitStorage`'s, if in scope    |
| everything else           | yours, untouched                     |

Capability plugins go first so a `Captcha` challenge is checked before another
plugin's request hook runs. `plugins` is a fixed-length tuple rather than a
spread of an array-typed field — a leading rest builds a variadic tuple Better
Auth's head-first `InferPluginFieldFromTuple` cannot walk past, and the symptom
is `UserOf` silently losing plugin-contributed fields.

It returns an Effect because two combinations typecheck and are still incoherent,
and only `configure` can see them — the check depends on which Layers are in
scope, which is exactly what `serviceOption` hides from the type:

| `BaeConfigError`           | Raised when                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `CapabilityPluginConflict` | you passed a plugin a capability already wires (carries `id`)                        |
| `RateLimitStorageConflict` | you set `rateLimit.storage` while `RateLimitStorage` is in scope (carries `storage`) |

Both are `Data.TaggedError`, so `Effect.catchTag` names one. Nothing is checked
until the options are built — once per isolate, and once on the deploy host,
which fails first.

## Building and mounting

| Export                   | Signature                                                |
| ------------------------ | -------------------------------------------------------- |
| `makeAuth(config)`       | `Effect<O, E, R> => Effect<CachedAuth<O, E>, never, R>`  |
| `makeHandler(config)`    | `Effect<O, E, R> => Effect<AuthHandler<O, E>, never, R>` |
| `makeEffectAuth(config)` | `Effect<O, E, R> => Effect<EffectAuth<O, E>, never, R>`  |

Each wraps the one below it. Pick the highest that fits.

**`CachedAuth<O, E>`** is `Effect<Auth<O>, E | AuthInitFailed>` — memoised, so
one in-flight build is shared and its success retained for the isolate. Failed
builds are _not_ retained, so one transient database failure cannot poison the
isolate. `AuthInitFailed` exists because `createBetterAuth` stores the init
promise and nothing awaits it until the first request; forcing it inside the
build converts a late unhandled rejection into a typed failure.

**`AuthHandler<O, E>`** is three members:

| Member   | Type                                                                 |
| -------- | -------------------------------------------------------------------- |
| `auth`   | `CachedAuth<O, E>`                                                   |
| `handle` | `(request: Request) => Effect<Response, E \| AuthInitFailed>`        |
| `http`   | `Effect<HttpServerResponse, E \| AuthInitFailed, HttpServerRequest>` |

`http` requires the server request to be Web `Request`-backed and dies with a
named `TypeError` when it is not; a native Node request or Lambda event must be
converted and passed to `handle`.

**`EffectAuth<O, E>`** is four:

| Member   | Type                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| `api`    | `EffectApi<O, E>`                                                                                                |
| `call`   | `<A>(f: (api: Auth<O>["api"]) => Promise<A>) => Effect<A, AuthApiError \| AuthApiDefect \| E \| AuthInitFailed>` |
| `http`   | `AuthHandler<O, E>["http"]`                                                                                      |
| `handle` | `AuthHandler<O, E>["handle"]`                                                                                    |

**`EffectApi<O, E>`** is `Auth<O>["api"]` keyed endpoint for endpoint, with
`Effect` where there was a `Promise`. Plugin endpoints are present exactly when
the plugin is: `listUsers` exists _because_ `admin()` is in `plugins`. It is a
Proxy, because the key set is not knowable at construction — forcing the instance
to read its keys is the one thing that cannot succeed on a deploy host. `then`
and every symbol are refused rather than forwarded, so the object can never be
mistaken for a thenable.

`call` is the escape hatch for endpoints whose **return type depends on their
arguments**. The mirror's `infer` collapses those to one instantiation, so
`getSession({ returnHeaders: true })` types as the session instead of
`{ headers, response }`. That is the one a gateway needs, because
`headers.getSetCookie()` is how a rotated cookie reaches the edge.

Failures are values, not defects:

| Error            | Means                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AuthApiError`   | Better Auth's `APIError`. Carries `status` (the number), `code` (its stable string, or `undefined` — never synthesised), `message`, `body` |
| `AuthApiDefect`  | anything else the call threw — a bug in a callback, not a delivery outcome                                                                 |
| `AuthInitFailed` | Better Auth could not initialise its context; almost always the database                                                                   |

A `401` for no session is the _answer_, not a bug, which is why it is a typed
failure. `handle`/`http` are the other way round: Better Auth turns its own
`APIError` into a response, so anything escaping there is a defect.

## Naming what came out

Every helper takes the **config Effect**, not an options type — which removes the
reason to declare one, and declaring one is how plugin inference gets destroyed.

| Type               | Is                                                                   |
| ------------------ | -------------------------------------------------------------------- |
| `AuthOptionsOf<C>` | the exact options type the config produces                           |
| `AuthOf<C>`        | `Auth<AuthOptionsOf<C>>`                                             |
| `ApiOf<C>`         | `auth.api` for this config — every endpoint, including each plugin's |
| `UserOf<C>`        | the user model, widened by plugins and `user.additionalFields`       |
| `SessionOf<C>`     | the session model, widened the same way                              |
| `ErrorCodesOf<C>`  | `$ERROR_CODES`, core plus each plugin's                              |

Inference collapse is silent — `auth.api` degrades to a plugin-free client and
nothing errors — so `test/types.test.ts` asserts a plugin-contributed field is
present _and_ mutates the config to prove the assertion fails when it is not.

## Telemetry

Not a capability: a tracer is fiber-ambient, every span is opened by machinery
rather than by a body, and making it a tag would put `Tracer` in the requirement
channel of all 226 callback positions to no end. It is a `Layer<never>` instead,
and a deployment that provides nothing gets Effect's no-op tracer.

### Wiring it, end to end

Three edits, in three different places, and all three are needed — one names the
spans, one opens their root, one decides where they go.

```ts
// 1. NAME. Post-process the options. Inert without a tracer, so this can stay
//    in whether or not the deployment has a destination.
const traced = Effect.map(authConfig, (options) => withTracing(options));

// 2. ROOT + 3. DESTINATION. Both at the mount, because the tracer Layer's scope
//    has to be the request — see below.
Effect.gen(function* () {
  const auth = yield* makeEffectAuth(traced);

  const fetch = (request: Request) =>
    withRequestSpan(request, auth.handle(request)).pipe(
      Effect.provide(
        layerOtlpWorker({
          url: "https://api.axiom.co/v1/traces",
          headers: { authorization: `Bearer ${token}`, "x-axiom-dataset": "auth" },
          serviceName: "auth",
        }),
      ),
    );

  return { fetch: Effect.orDie(fetch) };
}).pipe(Effect.provide(capabilities));
```

What you get: one `POST /api/auth/sign-in/email` server span per request, with a
child span per callback the request actually reached —
`bae.emailAndPassword.sendResetPassword`, `bae.databaseHooks.user.create.after`
— each timed over the whole Effect, not just its synchronous head.

Skip step 1 and the trace has a request span and nothing under it. Skip step 2
and every callback span becomes its own root, so the trace is one span per
callback with no request to hang them on. Skip step 3 and all of it is a no-op,
which is exactly what "tracing is off" should cost.

**On a long-lived server** — Node, Bun, a container — provide `layerOtlp` once at
the top instead, and drop it from the request path. The per-request placement is
a Cloudflare requirement, not the general shape.

**From the environment**, when the destination is a deploy-time decision rather
than a code one:

```ts
Effect.provide(layerOtlpFromEnv({ serviceName: "auth" }));
```

reads `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (or `OTEL_EXPORTER_OTLP_ENDPOINT`),
`OTEL_EXPORTER_OTLP_HEADERS`, and `OTEL_SDK_DISABLED`. Absent or disabled yields
`Layer.empty` — the no-op tracer — so an un-configured stage traces nothing
rather than failing to boot. Note that `OTEL_SERVICE_NAME`, if set, **wins** over
the `serviceName` you pass; the environment is checked first, which is the
opposite of the usual precedence.

**Instrumenting a plugin.** `withTracing` does not descend into `plugins` —
those are functions Better Auth built, not callbacks you supplied. Name the
plugin's own option object instead, with its own prefix and its own paths:

```ts
plugins: [
  twoFactor(
    withTracing(twoFactorOptions, {
      prefix: "bae.twoFactor",
      paths: ["otpOptions.sendOTP"],
    }),
  ),
];
```

### The pieces

**`withTracing(options, config?)`** post-processes a config object, naming each
span after the config path it fills — a boundary cannot know which position it is
filling, and one name for all of them is worse than no span. Structurally
identical output: same keys, same references for everything not instrumented.
Inert without a tracer, so it is safe to leave in.

`TracingOptions`:

| Field        | Default                | Meaning                                                                                                                                                                                   |
| ------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefix`     | `"bae"`                | span-name prefix, so `bae.databaseHooks.user.create.after`                                                                                                                                |
| `paths`      | `CORE_TRACED_PATHS`    | dotted paths to instrument, relative to the object passed in. Supply this when instrumenting a **plugin's** option object                                                                 |
| `parent`     | request's current span | `() => ParentSpanRef \| undefined`, read at call time. `ParentSpanRef` is `{ traceId; spanId; sampled? }` — `@opentelemetry/api`'s `SpanContext` structurally, so nothing here imports it |
| `attributes` | —                      | extra attributes on every callback span                                                                                                                                                   |

**`CORE_TRACED_PATHS`** (48 entries) is an allow-list, not a deny-list, and that
direction is deliberate: a deny-list is silently wrong whenever Better Auth grows
a new _synchronous_ option and the failure is a broken deployment; an allow-list
is silently wrong whenever it grows a new _asynchronous_ callback and the failure
is a missing span. **`CORE_UNTRACEABLE_PATHS`** (9 entries) is the complement a
test asserts disjointness against — `database` (called synchronously, must return
an `Adapter`), `advanced.database.generateId`, `logger.log`,
`session.cookieCache.version`, `advanced.backgroundTasks.handler`,
`emailAndPassword.customSyntheticUser`, and `secondaryStorage.get`/`.set`/
`.getAndDelete`. Wrapping any of them substitutes `[object Promise]` for a row id
or breaks the instance at init.

`plugins` is not descended into, for a second and independent reason: those are
functions Better Auth built, not callbacks you supplied — hence the per-plugin
form above.

**The request root span.** `withRequestSpan(request, effect, options?)` opens it;
without it every callback span becomes its own root. `options` is `name?`
(defaults to `POST /api/auth/sign-in/email`), `attributes?`, and `root?`
(defaults `true` — a span whose parent is not exported is a broken trace, and on
Cloudflare that is the default situation). An incoming `traceparent` always wins.
`parentFromRequest(request)` reads it — W3C first, then B3 and X-B3.

**The destination.** Three `Layer<never>`s:

| Layer                     | For                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `layerOtlp(opts)`         | the general case; OTLP/HTTP **JSON** over `fetch`                                   |
| `layerOtlpWorker(opts)`   | a Cloudflare isolate. **Provide per request, not per isolate**                      |
| `layerOtlpFromEnv(opts?)` | the standard `OTEL_*` variables; absent or `OTEL_SDK_DISABLED` yields `Layer.empty` |

`layerOtlpWorker` is the one to read the doc for. Effect's exporter has three
ways to post — a forked interval loop, an early fork at `maxBatchSize`, and a
Scope finalizer. The first two are bets that the isolate is still running after
it answered, and Cloudflare makes no such promise. So this pushes everything onto
the finalizer (60s interval, 100k batch ceiling), giving exactly one POST per
request, issued before the response returns, at the cost of that request waiting.

`OtlpOptions`:

| Field            | Default                          | Meaning                                                                                                                                              |
| ---------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`            | required                         | full traces endpoint, e.g. `https://api.axiom.co/v1/traces`                                                                                          |
| `headers`        | —                                | `Authorization`, `X-Axiom-Dataset`, whatever the backend wants                                                                                       |
| `serviceName`    | `DEFAULT_SERVICE_NAME` (`"bae"`) | `service.name` on every span. **`OTEL_SERVICE_NAME` wins over it** — the environment is checked first, which is the opposite of the usual precedence |
| `serviceVersion` | —                                |                                                                                                                                                      |
| `attributes`     | —                                | resource attributes                                                                                                                                  |
| `exportInterval` | `"5 seconds"`                    | `` `${number} ${"millis" \| "seconds"}` ``                                                                                                           |
| `maxBatchSize`   | 1000                             | spans buffered before an export is forked                                                                                                            |
| `fetch`          | the runtime's                    | a `FetchLike`. For a Service-binding-reached collector, an egress proxy, or capturing the payload in a test                                          |

`FetchLike` is structural rather than `typeof globalThis.fetch` on purpose: the
runtimes disagree (bun's carries `preconnect`, Cloudflare's `Fetcher.fetch` does
not), and a Worker handing its Service binding straight in would fail to
typecheck against either.

Worth knowing: when a `fetch` override does not take, the exporter catches
transport errors into `Effect.logDebug` and disables itself for 60 seconds — so a
misrouted exporter reports nothing anywhere and the deployment looks healthy
while emitting no spans at all.

**Better Auth's own spans** join this trace only if a real `TracerProvider` and a
context manager that survives `await` are registered on the global
`@opentelemetry/api` singleton. On Cloudflare the question does not arise:
`@better-auth/core` maps the `workerd` condition to a build whose `withSpan` is
`return fn()`, so its instrumentation is compiled out entirely. That is why this
module has **no** OpenTelemetry dependency.

---

## Why one wrapper covers the whole surface

Better Auth's injection points are plain functions in an options object. They
differ in arity (0–3), in whether they are awaited, and in what they return. The
obvious design — one adapter per shape — does not generalise, and leaves the
synchronous positions unreachable.

One variadic wrapper covers all of them, because TypeScript's contextual typing
flows _through_ a generic call into the callback argument.

The measurement behind that predates this repo — it was made in the prototype
this package was extracted from, and is mechanical rather than argued:

- An enumerator walks the real `BetterAuthOptions` plus every plugin's option
  type with the TypeScript checker and finds **226 callback positions** — 57
  core, 169 across 22 plugins; 192 async, 27 sync, 7 opaque.
- A generator emits one declaration per position, assigning this wrapper's
  output into that position's exact type reached by indexed access. **224
  typecheck**, with no `as`, no `any`, no `@ts-ignore`.
- The two that do not are `admin.ac.newRole` and `organization.ac.newRole`. They
  are generic signatures, which the primitive genuinely cannot supply — and they
  are not injection points, because `ac` is the value `createAccessControl()`
  returns, so Better Auth supplies `newRole` and you pass the result.
- **The control that makes it non-vacuous:** the same generated file against
  `Boundary<never>` produces **226 errors**, one per position. Every position
  passes _because_ the boundary carries the capabilities.

So the honest claim is: every position a user implements is covered.
`CORE_TRACED_PATHS` is the surviving artefact of that enumeration.

## What is enforced, and what is only documented

`fnSync` serves the 27 positions Better Auth never awaits. An Effect that
suspends cannot run synchronously, so it throws `SuspendedInSyncPosition` rather
than returning a broken value. `test/live.test.ts` proves that fires inside a
real Better Auth call path — and, more importantly, that **no row is written**
when it does.

An earlier design claimed this constraint was checked at _compile_ time, via a
phantom `SyncEffect` marker. That claim was false in both directions and the
marker has been deleted rather than left as decoration: `fnSync` never demanded
it, and `Effect.map` and `Effect.gen` both erase it anyway — i.e. every realistic
callback body erases it. `Contract.ts` §2 has the full note.

## The rules that are not negotiable

Each of these was established by something breaking, not by taste.

- **Never annotate the config Effect as `Effect<BetterAuthOptions, …>`.** That is
  the one move that destroys plugin inference, and it has happened twice here.
  You no longer write `satisfies BetterAuthOptions` either — `configure`'s
  parameter is constrained, so the check happens whether or not you remember it,
  and `Types.ts`'s helpers exist so nobody needs a named options type to point at.
- **`makeAuth`'s parameter is `Effect<O, E, R>` with `O extends BetterAuthOptions`,
  never `Effect<BetterAuthOptions, E, R>`.** `betterAuth` recovers every plugin
  endpoint from `Options` by inference; the non-generic form collapses
  `Auth<Options>` to `Auth<BetterAuthOptions>` and silently deletes the entire
  plugin API surface from the result type.
- **`Database` hands back a resolved value, never a coloured Effect.** Making it
  `Effect<_, _, RuntimeContext>` would put alchemy's tag in this package's
  contract. A backing needing per-invocation resolution supplies a façade —
  proved sufficient for the hardest case, a Neon pool that only exists per Lambda
  invocation.
- **`$context` is awaited inside the build.** `createBetterAuth` stores the init
  _promise_ and nothing awaits it until the first request, so a bad database
  surfaces as a late unhandled rejection. Forcing it produces an
  `AuthInitFailed` instead.
- **Eager vs. lazy is the host's `yield*`, not a baked-in default.** Yield the
  cached Effect during Layer construction and a broken database fails the Layer,
  which is right for a long-lived server. Do not, and nothing is built until the
  first request — which is _required_ inside a Cloudflare Worker impl, whose body
  also runs at deploy time when no env exists and every resource `Output` is an
  unresolved expression.
- **`enterRequest` wraps the call into `auth.handler`.** Not an optimisation:
  callbacks built by `makeRequestBoundary` resolve their services from the
  AsyncLocalStorage it installs, so without it the first POST that touches one
  throws `NoRequestInScope`. `makeHandler` and `makeEffectAuth` both do it for
  you; a host reaching past them to a raw `Auth<O>` does not get it.
- **`trustedOrigins` is explicit and never implicitly widened.** A preview
  wildcard like `*.workers.dev` reads as a convenience and is a CSRF hole: Better
  Auth expands `allowedHosts` into `trustedOrigins`, so the check then passes for
  every host on that domain, including one an attacker controls.

## The import gate

The package's central claim is that it is resource-agnostic. That is worth
exactly as much as its enforcement, so `scripts/check-purity.ts` checks the
**emitted JS** of every entry point, not the source. `effect`, `better-auth` and
`node:async_hooks` — including their subpaths — are the whole allowed list.
Current output:

```
src/index.ts     -> better-auth, better-auth/api, better-auth/plugins, effect,
                    effect/unstable/{http,observability}/*, node:async_hooks
src/Boundary.ts  -> effect, node:async_hooks
src/Contract.ts  -> effect
src/Auth.ts      -> better-auth, effect
src/Handler.ts   -> better-auth, effect, effect/unstable/http/*, node:async_hooks
src/Tracing.ts   -> effect, effect/unstable/*, node:async_hooks
```

No alchemy, no `cloudflare:*`, no filesystem, and — note `Tracing.ts` — no
OpenTelemetry: the OTLP exporter is Effect's own, over `fetch`.

The gate carries its own control, and the run fails if the control ever stops
catching — a gate that cannot fail is worse than no gate, because it reads as
evidence. The control exists because the obvious implementation is broken:
`Bun.build({ external: ["*"] })` externalises _relative_ specifiers too, so a
barrel re-export hides everything behind it. A module re-exporting
`alchemy/Cloudflare` through a barrel passes such a check. `packages: "external"`
is the correct setting, and the control demonstrates the difference on every run.

## What this package is not

No Layers, no resources, no deployment. `bae` defines the seams; backing them is
the consuming app's job — here, `apps/platform.auth/api/capabilities.ts` for the
Worker and `inert.ts` for the deploy host. Keeping that split honest is what the
import gate is for.

Nothing here reads the plugin list either. `lib.better-auth-manifest` does that,
off the runtime value (`options.plugins[].id`) rather than the type, because
plugin ids are not usefully reachable from the options type.

There is no client half here. The browser side of an auth system cannot import
`node:async_hooks`, and putting it behind a subpath export would make the
boundary a convention rather than a fact.
