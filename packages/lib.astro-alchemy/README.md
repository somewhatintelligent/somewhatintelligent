# lib.astro-alchemy

Astro SSR on Cloudflare Workers, as an Alchemy resource.

`Cloudflare.Website.Vite` can't build Astro — Astro's build is driven by the
`astro` CLI, not a plain `vite build`. But Astro exposes a **Node API**
(`build` / `dev`, taking an `AstroInlineConfig extends AstroUserConfig`), so
this resource drives it directly and injects the Cloudflare adapter with
options derived from the stack. Exactly as `Website.Vite` injects the
Cloudflare vite plugin rather than asking you to add it yourself.

Verified against Astro `7.1.6` · `@astrojs/cloudflare` `14.1.7` · `alchemy@2.0.0-beta.67`.

---

## Usage

Your Astro config holds app concerns only — no adapter, no `output`, no
`outDir`, no `configPath`:

```js
// apps/site/astro.config.mjs
export default defineConfig({ integrations: [svelte()] });
```

Everything Cloudflare-facing is declared once, in the stack:

```ts
// apps/site/index.ts
import { Astro } from "lib.astro-alchemy";
import { fileURLToPath } from "node:url";

export class Site extends Astro<Site>()("Site", {
  cwd: fileURLToPath(new URL(".", import.meta.url)),
  cache: { enabled: true },
  env: {
    SESSION: SessionKv, // Astro sessions over KV
    CACHE: Cache,
    UPLOADS: Uploads,
    API: ApiWorker, // service binding to an Effect-native Worker
    GREETING: "hello",
  },
}) {}

/** The workerd `Env`, derived — never hand-written. */
export type SiteEnv = Cloudflare.InferEnv<typeof Site>;
```

```ts
// stacks/site/alchemy.run.ts — passes no paths
export default Alchemy.Stack(
  "Site",
  { providers, state },
  Effect.gen(function* () {
    yield* ApiWorker;
    const site = yield* Site;
    return { url: site.url };
  }),
);
```

**The rule, with no exceptions: Cloudflare concerns go in the stack, Astro
concerns go in `astro.config.mjs`.** The resource overrides exactly four keys
(`root`, `configFile`, `output`, `outDir`). Everything else in your config
passes through untouched — arrays concatenate and objects deep-merge, so
`integrations`, `markdown`, `image`, `site`, `vite`, `server.port` and
`session` all stay where they belong.

---

## Who owns what

**Alchemy is the deployment authority.** The stack declares the Worker, so
deploying touches no wrangler config in either direction — `main`, `bundle`,
`assets` and `compatibility` come straight from the props. The
`dist/server/wrangler.json` the adapter's toolchain emits belongs to the
`wrangler deploy` path, which Alchemy replaces wholesale; nothing here reads it.

For `alchemy dev` the direction reverses. Wrangler config is the format the
Cloudflare Vite plugin behind `astro dev` speaks, so the resource **generates**
`.dev.wrangler.json` from the stack's `env`. You don't author that one either.

What the resource encodes is not the adapter's config but the adapter's build
**output layout**, the same way `Website.Vite` knows where Vite puts things:

| Concern             | Declared as                          | Notes                                                              |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| project root        | `cwd`                                | passed to Astro as its `root`; the stack may live anywhere         |
| out dir             | `outdir`                             | forced into Astro's config, so the two can't disagree              |
| server entry        | derived: `<outdir>/server/entry.mjs` | must be a **static string**, not an `Output`                       |
| pre-bundled output  | `bundle: false`                      | **mandatory** — re-bundling breaks the route manifest              |
| static assets       | derived: `<outdir>/client`           | server/client already split                                        |
| compat flags        | `compatibility.flags`                | `nodejs_compat` added automatically — the adapter emits none       |
| session KV          | `env: { SESSION: … }`                | required, or `Astro.session` throws                                |
| Images              | `env: { IMAGES: … }`                 | **absent** unless bound                                            |
| binding names       | `sessionBinding` / `imagesBinding`   | injected into the adapter                                          |
| rest of the adapter | `adapter`                            | `imageService`, `prerenderEnvironment`, … (JSON-serializable only) |
| Workers cache       | `cache: { enabled: true }`           | plain passthrough                                                  |

### Path independence

`cwd` is the only path knob, and it is handed to Astro as its `root` rather
than inherited from the process, so the stack file can live in a different
directory, a different package, or a monorepo root. `configFile` may be
absolute or relative to `cwd` — it is normalized to root-relative, because
Astro does `path.join(root, configFile)`.

The generated build runner is written to `<cwd>/.alchemy/` on purpose: its bare
`astro` and `@astrojs/cloudflare` imports resolve from its own location, so it
has to sit next to the app's `node_modules`.

---

## Local dev

`alchemy dev` skips the build, generates `.dev.wrangler.json` from the stack,
runs a generated module that calls astro's `dev()` directly, and puts the
Worker in `dev: { mode: "external" }`. With no `astro` CLI in the loop there is
no daemon to outlive `alchemy destroy`.

| Binding                   | Status | Note                                                     |
| ------------------------- | ------ | -------------------------------------------------------- |
| KV / R2 / D1 / vars       | works  | miniflare-local stores — names match, **state does not** |
| Service → Alchemy Worker  | works  | bridged registry, no cloud round-trip                    |
| SESSION / IMAGES / ASSETS | works  | adapter auto-provides                                    |

Service bindings work because of the registry bridge. Alchemy runs **workerd
directly, not miniflare**, and writes its dev registry to
`~/.local/state/alchemy/registry` in a different shape, so the resource
translates each entry into miniflare's `WorkerDefinition` and points
`astro dev` at the result via `MINIFLARE_REGISTRY_PATH`.

The load-bearing detail is the **file name**, not the contents. miniflare keys
its registry by the verbatim filename and writes its own entries with no
extension (`__asset-worker__`, `site-dev`), while alchemy writes
`<name>.json`. Bridge the file across unchanged and miniflare registers a
worker called `<name>.json` while the config asks for `<name>` — surfacing
only as `Worker "…" not found. Make sure it is running locally.`

miniflare reaps registry entries older than 5 minutes, so stale bridges
self-clean; a dev session that outlives its entry needs a re-deploy to rewrite
it. Both `experimental_remote: true` (silently ignored) and `remote: true`
(stops `astro dev` booting) were tested and are dead ends.

---

## Tests

`test/fixture/` is a real Astro app — content collections, actions,
middleware, a Svelte island, `_redirects`, and an Effect-native sibling Worker
with an R2 capability layer. The suites deploy it to **real Cloudflare** and
tear it down again.

```sh
bun run test        # e2e: deploys ApiWorker + Site + KV + R2, 13 assertions, destroys
bun run test:dev    # alchemy dev: generated wrangler config + registry bridge
bun run typecheck   # the package
```

`NO_DESTROY=1` keeps the stack up between runs while iterating.

The dev suite asserts the registry bridge two ways: that the bridged file is
named exactly what the generated wrangler config asks for, and that a request
through the service binding actually reaches Alchemy's local Worker. The first
matters because miniflare writes its own entries into the same directory —
asserting on "some file in there" passes whether or not the bridge wrote
anything.

### `astro sync`, and why it isn't in the gate

`astro sync` generates `test/fixture/.astro/types.d.ts` — the TypeScript
declarations for Astro's virtual modules (`astro:content`, `astro:actions`,
`astro:middleware`, `astro:schema`) plus the collection types derived from
`content.config.ts`. Without it, a standalone `tsc` over the fixture cannot
resolve those imports.

Nothing in this repo runs it, and it is not wired into `vp check`:

- `astro build` and `astro dev` run sync themselves, so **the e2e never needs
  it** — the fixture is typechecked-by-building on every run.
- The package `tsconfig.json` **excludes `test/fixture/src/**`** precisely so
  `bun run typecheck` doesn't depend on a generated file. Files the tests
  import directly (`fixture/infra/*`) are still checked, because tsc follows
  imports.

So it exists only for editor/tsc feedback on the fixture's `.astro` pages, as
an opt-in:

```sh
bun run typecheck:fixture   # runs sync, then tsc against the fixture's own tsconfig
```

The e2e covers: per-request SSR, prerendered routes off the ASSETS layer,
`nodejs_compat`, Astro sessions over bound KV, KV/R2/var/service bindings,
typed RPC via `toRpcAsync` into the Effect Worker, `InferEnv` types, Svelte
island SSR + hydration chunks, middleware on SSR but not on assets, Astro
Actions (success and typed `ActionError`), `_redirects`, `IMAGES` absent unless
bound, Workers Cache, and the cwd-independence of the generated runner.

The fixture is excluded from the package tsconfig and carries its own, because
its pages import virtual modules (`astro:content`, `astro:actions`) that only
exist after astro generates `.astro/types.d.ts`.

---

## Footguns

Each cost real debugging time. Most fail with no useful diagnostic.

| Symptom                                                                                 | Cause and fix                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TypeError: undefined is not an object (evaluating 'main.split("?")[0]')`               | `main` must be a **static string**. Worker pre-create runs concurrently with `Command.Build`, so an `Output` is unresolved there. ([alchemy#1049](https://github.com/alchemy-run/alchemy/issues/1049))          |
| `ERR_SERVER_NOT_RUNNING` at end of build                                                | The runner must run under **`node`, not `bun`**. The adapter's prerenderer disposes a miniflare instance at end-of-build.                                                                                       |
| Build lands where the Worker isn't looking                                              | An `outDir` in `astro.config.mjs` used to win the build while the resource derived paths from its own `outdir`. Now forced, so they can't diverge.                                                              |
| Every deploy rebuilds, nothing changed                                                  | Gitignore `.alchemy/`. `.alchemy/log/out` is rewritten each deploy, changing `Command.Build`'s input hash forever.                                                                                              |
| `astro dev: Failed to load url os`                                                      | Never import the `alchemy/Cloudflare` barrel in app code — it pulls `node:os`. Use `alchemy/Cloudflare/Bridge`.                                                                                                 |
| `Dev server process exited before becoming ready`                                       | R2 `bucket_name` must be **lowercase** in the dev config. That is the entire diagnostic.                                                                                                                        |
| Duplicate resources: `Site/ApiWorker` alongside `ApiWorker`                             | Namespace only the Build. ([alchemy#1052](https://github.com/alchemy-run/alchemy/issues/1052))                                                                                                                  |
| Worker re-uploads on every deploy                                                       | `assets.hash` must be a string. ([alchemy#1056](https://github.com/alchemy-run/alchemy/issues/1056))                                                                                                            |
| SSR routes stop re-rendering                                                            | Workers Cache fronts the **whole** Worker. Every dynamic route needs `Cache-Control: no-store`. Nothing errors.                                                                                                 |
| Site serves `Alchemy worker is being deployed...` forever after a **successful** deploy | Same cache, nastier. Alchemy's pre-create stub is a 200 with no `Cache-Control`; hit the URL during the upload window and the edge caches it in front of a good deploy. Confirm with `?cb=1`; clear by purging. |
| Action response isn't the object you expected                                           | Astro Actions are devalue-encoded, not plain JSON.                                                                                                                                                              |
| Redirect test asserts 200                                                               | `HttpClient` follows 3xx at the transport level — assert the outcome.                                                                                                                                           |

---

## Known gaps

- A dev session longer than 5 minutes outlives its bridged registry entry
  (miniflare reaps by mtime); re-deploying rewrites it. A keep-alive touch
  would fix it properly.
- The `adapter` passthrough is typed and merged but no option has been
  exercised end to end — `imageService: "passthrough"` in particular.
- Dropping the session KV entirely via a non-Cloudflare `session.driver`
  (e.g. `sessionDrivers.null()`) is traced through the adapter source but
  never built. The adapter always installs _some_ driver; only the Cloudflare
  one demands a KV namespace.
- `auxiliaryWorkers` — would be separate `Worker` resources.
- Windows paths: the runner command uses `path.relative`, which yields
  backslashes there.
