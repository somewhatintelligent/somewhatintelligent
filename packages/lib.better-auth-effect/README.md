# bae — better-auth-effect

Better Auth's **entire** configuration surface, written as Effect code against
service tags, with no knowledge of what backs any of them.

```ts
const options = Effect.gen(function* () {
  const bae = yield* Bae;
  const run = yield* makeBoundary<Mail>();

  return yield* bae.configure({
    secret: "load-this-from-config",
    emailAndPassword: {
      enabled: true,
      sendResetPassword: run.fn((data) =>
        // `data` is INFERRED
        Effect.gen(function* () {
          const mail = yield* Mail; // requirement, satisfied by R
          yield* mail.send({ to: [data.user.email], subject: "Reset", text: data.url });
        }),
      ),
    },
  });
});

// R = Database | Mail, and the host discharges it.
const mount = Effect.gen(function* () {
  const { handle } = yield* makeHandler(options);
  return handle;
});
```

Nobody declares that dependency list — it **is** the set of tags the body
reached for. Discharging it is the host's job. Forgetting one is a type error at
the callback that needed it:

```
Type 'Effect<void, never, { readonly _tag: "Mail"; }>' is not assignable to
type 'Effect<void, never, never>'.
```

Server-only. `Boundary.ts` needs `node:async_hooks`.

```sh
bun test                              # 36 pass
bun run typecheck
bun run scripts/check-purity.ts       # the import gate, with its own control
```

---

## The four modules

| Module        | What it is                                                         |
| ------------- | ------------------------------------------------------------------ |
| `Boundary.ts` | the primitive — Effect code into any Better Auth callback          |
| `Contract.ts` | the seven capability tags a configuration can reach for            |
| `Auth.ts`     | config Effect → memoised `Auth<O>`, with a typed init failure      |
| `Handler.ts`  | `Request => Effect<Response>`, with the request boundary installed |

## Why one wrapper covers the whole surface

Better Auth's injection points are plain functions in an options object. They
differ in arity (0–3), in whether they are awaited, and in what they return.
The obvious design — one adapter per shape — does not generalise, and leaves the
synchronous positions unreachable.

One variadic wrapper covers all of them, because TypeScript's contextual typing
flows _through_ a generic call into the callback argument.

The evidence is in `prototypes/full-surface`, and it is mechanical rather than
argued:

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
callback body erases it. `Contract.ts` §2 has the full note. `SyncCapabilities`
survives as documentation of which backings must not suspend.

## The rules that are not negotiable

Each of these was established by something breaking, not by taste.

- **`satisfies BetterAuthOptions`, never `: BetterAuthOptions`.** The annotation
  widens the object literal and throws away the literal types Better Auth's
  plugin inference depends on.
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
  throws `NoRequestInScope`.
- **`trustedOrigins` is explicit and never implicitly widened.** A preview
  wildcard like `*.workers.dev` reads as a convenience and is a CSRF hole: Better
  Auth expands `allowedHosts` into `trustedOrigins`, so the check then passes for
  every host on that domain, including one an attacker controls.

## The import gate

The package's central claim is that it is resource-agnostic. That is worth
exactly as much as its enforcement, so `scripts/check-purity.ts` checks the
**emitted JS** of every entry point, not the source. Current output:

```
src/index.ts     -> ["better-auth","effect","node:async_hooks"]
src/Boundary.ts  -> ["effect","node:async_hooks"]
src/Contract.ts  -> ["effect"]
src/Auth.ts      -> ["better-auth","effect"]
src/Handler.ts   -> ["better-auth","effect","node:async_hooks"]
```

The gate carries its own control, and the run fails if the control ever stops
catching — a gate that cannot fail is worse than no gate, because it reads as
evidence. The control exists because the obvious implementation is broken:
`Bun.build({ external: ["*"] })` externalises _relative_ specifiers too, so a
barrel re-export hides everything behind it. A module re-exporting
`alchemy/Cloudflare` through a barrel passes such a check. `packages: "external"`
is the correct setting, and the control demonstrates the difference on every run.

## What this package is not

No Layers, no resources, no deployment. `bae` defines the seams; backing them is
`bae-alchemy`'s job, and keeping that split honest is what the import gate is for.

There is no client half here either. The browser side of an auth system cannot
import `node:async_hooks`, and putting it behind a subpath export would make the
boundary a convention rather than a fact.
