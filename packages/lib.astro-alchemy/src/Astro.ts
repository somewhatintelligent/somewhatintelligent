import type { Options as CloudflareAdapterOptions } from "@astrojs/cloudflare";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Cloudflare from "alchemy/Cloudflare";
import type {
  NormalizedBindings,
  WorkerAssetsConfig,
  WorkerBindingProps,
  WorkerProps,
} from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import type { InputProps } from "alchemy/Input";
import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import { effectClass, isYieldableEffectLike } from "alchemy/Util/effect";
import * as Effect from "effect/Effect";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

/**
 * Adapter options the stack owns and therefore cannot be passed through:
 * the binding names come from {@link AstroProps.sessionBinding} /
 * {@link AstroProps.imagesBinding}, and `configPath` is the dev wrangler
 * config this resource generates.
 */
type PassthroughAdapterOptions = Omit<
  CloudflareAdapterOptions,
  "sessionKVBindingName" | "imagesBindingName" | "configPath"
>;

export interface AstroProps<Bindings extends WorkerBindingProps = {}>
  extends
    Omit<WorkerProps<Bindings, WorkerAssetsConfig>, "assets" | "main" | "bundle" | "vite">,
    Omit<Command.BuildProps, "env" | "outdir" | "command"> {
  /**
   * Absolute or relative path to the Astro project root — the directory
   * holding `astro.config.mjs`, `src/`, and the `node_modules` that has
   * `astro` and `@astrojs/cloudflare` installed.
   *
   * This is the ONLY path knob. Everything else (config file, out dir, build
   * runner, dev wrangler config) is resolved from it, and it is passed to
   * Astro as its `root`, so the stack file may live anywhere — a different
   * directory, a different package, a monorepo root.
   *
   * A relative value resolves against `process.cwd()`; prefer
   * `fileURLToPath(new URL("../app", import.meta.url))` if the stack should
   * not care where it was invoked from.
   *
   * @default process.cwd()
   */
  cwd?: string;
  /**
   * Astro's `outDir`, resolved against {@link cwd}. The `@astrojs/cloudflare`
   * adapter splits it into `<outdir>/client` (static assets) and
   * `<outdir>/server` (the SSR Worker).
   *
   * The stack owns this: it is forced into Astro's config, so an `outDir` in
   * the app's `astro.config` is overridden rather than silently disagreeing
   * with where this resource looks for the build.
   *
   * @default "dist"
   */
  outdir?: string;
  /**
   * Path to the app's Astro config. Absolute, or relative to {@link cwd}.
   * Alchemy drives Astro's Node API and loads this config underneath its own
   * overrides — the same relationship `Website.Vite` has with your
   * `vite.config.ts`. Pass `false` to load no config file at all.
   *
   * @default "astro.config.mjs"
   */
  configFile?: string | false;
  /**
   * Name of the KV binding Astro's session driver uses. Injected into the
   * adapter, so it is declared HERE and nowhere else — put a KV namespace
   * under this key in `env`.
   *
   * To run with no session KV at all, set a non-Cloudflare driver in the
   * app's Astro config (`session: { driver: sessionDrivers.null() }`) and
   * leave the binding out of `env`; the adapter always installs *some*
   * session driver, but only the Cloudflare one demands a KV namespace.
   *
   * @default "SESSION"
   */
  sessionBinding?: string;
  /**
   * Name of the Cloudflare Images binding, or `false` to disable the
   * Images-backed image service. Injected into the adapter.
   * @default "IMAGES"
   */
  imagesBinding?: string | false;
  /**
   * The rest of the `@astrojs/cloudflare` adapter's options — `imageService`,
   * `prerenderEnvironment`, `persistState`, `remoteBindings`, `experimental`,
   * and so on. Merged UNDER the options this resource derives from the stack,
   * so the binding names always win.
   *
   * The build runs in a spawned `node` process and these cross as JSON, so
   * only serializable values survive. Function-valued options are not
   * supported.
   *
   * @example
   * ```ts
   * Astro("Site", { adapter: { imageService: "passthrough" } })
   * ```
   */
  adapter?: PassthroughAdapterOptions;
  /**
   * Escape hatch: run this instead of Alchemy's generated build runner. Doing
   * so gives up adapter injection, so anything the adapter needs must then be
   * configured in the app's astro.config by hand.
   */
  command?: string;
  /**
   * Escape hatch: run this instead of Alchemy's generated dev runner. Doing so
   * gives up adapter injection, so anything the adapter needs must then be
   * configured in the app's astro.config by hand.
   */
  devCommand?: string;
  /** Static-asset routing behavior (htmlHandling, notFoundHandling, ...). */
  assets?: Cloudflare.AssetsConfig;
}

type AstroWorker<Bindings extends WorkerBindingProps> = Cloudflare.Worker<{
  [b in keyof NormalizedBindings<Bindings, WorkerAssetsConfig>]: NormalizedBindings<
    Bindings,
    WorkerAssetsConfig
  >[b];
}>;

/**
 * An Astro SSR site (`output: "server"` + `@astrojs/cloudflare`) deployed as a
 * Cloudflare Worker with static assets.
 *
 * Mirrors `Cloudflare.Website.StaticSite` / `.Vite`: same call shapes (plain
 * and class form), same `const Bindings` inference, so `env` bindings are
 * typed and `Cloudflare.InferEnv<typeof Site>` yields the workerd `Env`.
 *
 * ## Who owns what
 *
 * Alchemy is the deployment authority: the stack declares the Worker, so
 * deploy involves no wrangler config in either direction. `main`,
 * `bundle: false`, `assets` and `compatibility` come straight from these
 * props. (The `dist/server/wrangler.json` the adapter's own toolchain emits is
 * an artifact of the `wrangler deploy` path, which Alchemy replaces; nothing
 * here reads it.)
 *
 * For `alchemy dev`, wrangler config is the format the Cloudflare Vite plugin
 * behind `astro dev` speaks, so this resource GENERATES it from the stack's
 * `env` — see the dev branch below. You never author it.
 *
 * What the resource does encode is the adapter's build OUTPUT layout, the same
 * way `Website.Vite` knows where Vite puts things:
 *
 *   main       -> <outdir>/server/entry.mjs
 *   assets     -> <outdir>/client
 *   bundle     -> false           (adapter pre-bundles; re-bundling breaks it)
 *   compat     -> nodejs_compat added (the adapter emits no flags of its own)
 *
 * @example Typed bindings + class form
 * ```ts
 * class Site extends Cloudflare.Website.Astro<Site>()("Site", {
 *   env: { CACHE: kv, API: apiWorker },
 * }) {}
 *
 * type Env = Cloudflare.InferEnv<typeof Site>;
 * ```
 *
 * @example App in a different directory from the stack
 * ```ts
 * class Site extends Cloudflare.Website.Astro<Site>()("Site", {
 *   cwd: fileURLToPath(new URL("../../apps/web", import.meta.url)),
 * }) {}
 * ```
 */
export const Astro: {
  <Self>(): {
    <const Bindings extends WorkerBindingProps = {}, Req = never>(
      id: string,
      propsEff?:
        | InputProps<AstroProps<Bindings>>
        | Effect.Effect<InputProps<AstroProps<Bindings>>, never, Req>,
    ): Effect.Effect<Self, never, Req | Cloudflare.Providers> & {
      new (): AstroWorker<Bindings>;
    };
  };
  <const Bindings extends WorkerBindingProps = {}, Req = never>(
    id: string,
    propsEff?:
      | InputProps<AstroProps<Bindings>>
      | Effect.Effect<InputProps<AstroProps<Bindings>>, never, Req>,
  ): Effect.Effect<AstroWorker<Bindings>, never, Req | Cloudflare.Providers>;
} = ((id?: any, propsEff?: any) =>
  id === undefined
    ? (id: string, propsEff: any) => effectClass(Astro(id, propsEff))
    : makeAstro(id, propsEff)) as any;

/**
 * Map one resolved `env` entry to a wrangler-config binding for `astro dev`.
 *
 * Alchemy's dev registry lives at `~/.local/state/alchemy/registry` and the
 * Cloudflare vite plugin behind `astro dev` does not read it, so an external
 * `astro dev` cannot see Alchemy's local Workers. Remote bindings don't bridge
 * it either (`remote: true` stops `astro dev` booting; `experimental_remote`
 * is silently ignored). So dev bindings are LOCAL emulations: correct names
 * and shapes, miniflare-backed state that is separate from both the cloud and
 * Alchemy's own local providers.
 *
 * Resource `Type` -> the wrangler-config array it belongs in, plus its entry.
 * One table, so adding Queues or Vectorize is a single line rather than an
 * edit in four places (union, switch, accumulator, config spread) where
 * missing the last one drops the binding silently.
 *
 * The `dev-` id must be LOWERCASE: R2 rejects otherwise, and the only
 * diagnostic is `Dev server process exited before becoming ready`.
 */
const DEV_BINDING: Record<string, (binding: string, id: string) => readonly [string, object]> = {
  "Cloudflare.KV.Namespace": (binding, id) => ["kv_namespaces", { binding, id }],
  "Cloudflare.R2.Bucket": (binding, id) => ["r2_buckets", { binding, bucket_name: id }],
  "Cloudflare.D1.Database": (binding, id) => [
    "d1_databases",
    { binding, database_name: id, database_id: id },
  ],
};

interface DevBindings {
  /** wrangler key -> entries, spread straight into the generated config. */
  arrays: Record<string, object[]>;
  vars: Record<string, string>;
  /** Output-valued plain vars, resolved into `vars` at reconcile. */
  varOutputs: Array<{ name: string; value: Output.Output<string> }>;
  /** Sibling Alchemy Workers, resolved and bridged at reconcile. */
  workerBindings: Array<{ binding: string; name: Output.Output<string> }>;
  /** Bindings with no `astro dev` equivalent; the caller warns about these. */
  skipped: string[];
}

/** Walk the stack's `env` and sort it into what `astro dev` can emulate. */
/** Sort one already-resolved `env` value into the collection. */
const addDevBinding = (out: DevBindings, name: string, value: unknown): void => {
  const type = (value as any)?.Type ?? (value as any)?.type;

  if (type === "Cloudflare.Worker") {
    // `workerName` is an Output: it resolves at reconcile, which is exactly
    // when the local worker is up and its registry entry exists.
    out.workerBindings.push({ binding: name, name: (value as any).workerName });
    return;
  }

  const toEntry = DEV_BINDING[type];
  if (toEntry) {
    const [key, entry] = toEntry(name, `dev-${name.toLowerCase()}`);
    (out.arrays[key] ??= []).push(entry);
    return;
  }

  if (typeof value === "string") out.vars[name] = value;
  else out.skipped.push(name);
};

const collectDevBindings = Effect.fn(function* (env: Record<string, unknown>) {
  const out: DevBindings = {
    arrays: {},
    vars: {},
    varOutputs: [],
    workerBindings: [],
    skipped: [],
  };

  for (const [name, raw] of Object.entries(env)) {
    // An Output is yieldable and must NOT be yielded: resolving one needs
    // RuntimeContext, which exists only at reconcile. This is alchemy's own
    // rule, not a local one — `bindWorkerAsyncBindings` guards it as
    // `isYieldableEffectLike(x) && !Output.isOutput(x)` and hands the Output
    // to the engine instead. Which is exactly why the deploy branch, whose
    // `env` reaches `Cloudflare.Worker` untouched, resolves a cross-stack
    // value (`yield* Auth` -> `auth.origin`) while this branch died on it.
    //
    // The Worker below still receives the Output untouched; the copy taken
    // here is only for the wrangler config `astro dev` reads, so it defers to
    // the same reconcile-time `Output.map` that resolves sibling worker names.
    if (Output.isOutput(raw)) {
      out.varOutputs.push({ name, value: raw as Output.Output<string> });
      continue;
    }

    // Module-level declarations (`Cloudflare.KV.Namespace("Cache")`) are
    // Effects, not resources — yield them so `Type` is inspectable. This is
    // the same resolution the deploy path's Worker does.
    //
    // `isYieldableEffectLike`, NOT `Effect.isEffect`: alchemy tags binding
    // Effects that must never be yielded here (`Cloudflare.URL`,
    // `WorkerLoader`) with `~alchemy/Kind`. `Cloudflare.URL` needs
    // RuntimeContext, which is unsatisfiable at stack-construction time — so a
    // plain `isEffect` check deploys fine and breaks only under `alchemy dev`.
    addDevBinding(out, name, isYieldableEffectLike(raw) ? yield* raw as Effect.Effect<any> : raw);
  }

  return out;
});

/**
 * Emit the module Alchemy runs instead of shelling out to the `astro` CLI.
 *
 * This is the whole point of the design: Astro exposes a Node API
 * (`build` / `dev`, taking an `AstroInlineConfig extends AstroUserConfig`),
 * so Alchemy can load the app's own `astro.config` via `configFile` and
 * layer its own overrides on top — injecting the Cloudflare adapter with
 * options derived from the stack. Exactly how `Website.Vite` injects the
 * Cloudflare vite plugin rather than asking you to add it yourself.
 *
 * Consequence: adapter options live in ONE place (this resource's props).
 * Nothing about bindings, session/images binding names, or the dev wrangler
 * config is authored twice.
 *
 * The runner is written INSIDE the Astro project root on purpose: its bare
 * `astro` / `@astrojs/cloudflare` imports resolve from its own location, so it
 * must sit next to the app's `node_modules`, not next to the stack file.
 *
 * `root` is passed explicitly rather than inherited from the spawned process's
 * cwd, so nothing here depends on where `alchemy deploy` was invoked from.
 *
 * Runs under `node`, not `bun`: the adapter's prerenderer tears down a
 * miniflare instance at the end of the build, which throws
 * ERR_SERVER_NOT_RUNNING under bun. Astro is a Node tool; the CLI swallowed
 * this, a top-level `await build()` propagates it.
 */
const writeRunner = (opts: {
  mode: "build" | "dev";
  file: string;
  root: string;
  outDir: string;
  configFile: string | false;
  adapter: Record<string, unknown>;
}) => {
  const inline = JSON.stringify(
    {
      root: opts.root,
      configFile: opts.configFile,
      output: "server",
      outDir: opts.outDir,
    },
    null,
    2,
  );
  const adapter = JSON.stringify(opts.adapter, null, 2);
  const body =
    opts.mode === "build"
      ? `await build({ ...inline, adapter: cloudflare(adapterOptions) });`
      : `const server = await dev({ ...inline, adapter: cloudflare(adapterOptions) });
// Command.Dev scans stdout for an http(s) URL.
const url = server.resolvedUrls?.local?.[0]
  ?? \`http://localhost:\${server.address.port}\`;
console.log(\`astro dev ready at \${url}\`);
// Plain foreground process — no CLI daemon to outlive the stack.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { server.stop().finally(() => process.exit(0)); });
}`;

  nodeFs.mkdirSync(nodePath.dirname(opts.file), { recursive: true });
  nodeFs.writeFileSync(
    opts.file,
    `// GENERATED by lib.astro-alchemy — do not edit.\n` +
      `import { ${opts.mode} } from "astro";\n` +
      `import cloudflare from "@astrojs/cloudflare";\n\n` +
      `const inline = ${inline};\n` +
      `const adapterOptions = ${adapter};\n\n` +
      `${body}\n`,
  );
};

/**
 * Translate ONE alchemy dev-registry entry into miniflare's `WorkerDefinition`.
 * Returns whether the entry existed and was bridged.
 *
 * The two registries agree on protocol but not on file naming, and that
 * detail is load-bearing:
 *
 *   alchemy    `<encodeURIComponent(scriptName)>.json`
 *   miniflare  `<encodeURIComponent(scriptName)>`      — NO extension
 *
 * miniflare keys the registry by the VERBATIM file name (`readdirSync`, then
 * `registry[name] = JSON.parse(...)`), so a bridged `foo.json` registers a
 * worker called `foo.json` while the wrangler config asks for `foo` — and the
 * only symptom is `Worker "foo" not found. Make sure it is running locally.`
 *
 * Entries are reaped by miniflare once their mtime is >5 min old, so stale
 * bridges self-clean and there is nothing to prune here. A dev session longer
 * than that outlives its bridged entry; re-running the deploy re-writes it.
 */
const bridgeRegistryEntry = (
  alchemyRegistry: string,
  bridgeDir: string,
  scriptName: string,
): boolean => {
  const key = encodeURIComponent(scriptName);
  const src = nodePath.join(alchemyRegistry, `${key}.json`);
  if (!nodeFs.existsSync(src)) return false;
  const entry = JSON.parse(nodeFs.readFileSync(src, "utf8"));
  const worker = (entry.services ?? []).find((s: { kind?: string }) => s.kind === "worker");
  if (!worker) return false;
  nodeFs.writeFileSync(
    nodePath.join(bridgeDir, key),
    `${JSON.stringify(
      {
        debugPortAddress: entry.debugPortAddress,
        defaultEntrypointService: worker.fetchService,
        userWorkerService: worker.rpcService,
      },
      null,
      2,
    )}\n`,
  );
  return true;
};

/**
 * Astro does `path.join(root, configFile)`, so an absolute config path would be
 * concatenated onto the root rather than replacing it. Normalize to
 * root-relative — `path.join` collapses a leading `..`, so a config living
 * outside the root still resolves.
 */
const resolveConfigFile = (
  root: string,
  configFile: string | false | undefined,
): string | false => {
  const raw = configFile ?? "astro.config.mjs";
  if (raw === false) return false;
  return nodePath.isAbsolute(raw) ? nodePath.relative(root, raw) : raw;
};

/**
 * Adapter options DERIVED FROM THE STACK, layered over the caller's
 * passthrough so the stack-owned binding names always win. The app's
 * astro.config never mentions them, so they exist in exactly one place.
 *
 * Both binding names pass through only when set, rather than restating the
 * adapter's own defaults ("SESSION" / "IMAGES") — one less constant to drift
 * when `@astrojs/cloudflare` changes them.
 */
const resolveAdapterOptions = (props: AstroProps<any>): Record<string, unknown> => ({
  ...props.adapter,
  ...(props.sessionBinding === undefined ? {} : { sessionKVBindingName: props.sessionBinding }),
  ...(props.imagesBinding === undefined ? {} : { imagesBindingName: props.imagesBinding }),
});

/** Shared by both branches, so the compat date has ONE home. */
const resolveCompatibility = (props: AstroProps<any>) => ({
  date: props.compatibility?.date ?? "2026-04-15",
  flags: ["nodejs_compat", ...(props.compatibility?.flags ?? [])],
});

const makeAstro = (id: string, propsEff?: any) =>
  Effect.gen(function* () {
    const props = ((yield* Effect.isEffect(propsEff) ? propsEff : Effect.succeed(propsEff ?? {})) ??
      {}) as AstroProps<any>;

    const ctx = yield* AlchemyContext;
    const outdir = props.outdir ?? "dist";

    // The single path anchor. Absolute, so nothing below depends on where the
    // stack file lives or where `alchemy deploy` was run from.
    const root = nodePath.resolve(props.cwd ?? ".");

    const configFile = resolveConfigFile(root, props.configFile);

    // `main` MUST be a static string, not an Output derived from the build:
    // the Worker's pre-create phase runs CONCURRENTLY with Command.Build, so
    // an Output is unresolved there and crashes getCompatibility ->
    // isPythonMain. Ordering comes from the Output-valued `assets` below.
    // Absolute, matching `root`; Worker uses `main` as given.
    const main = nodePath.join(root, outdir, "server/entry.mjs");

    const runnerDir = nodePath.join(root, ".alchemy");

    const adapterOptions = resolveAdapterOptions(props);
    const compatibility = resolveCompatibility(props);

    // Props this resource consumes itself; everything else is Worker props.
    const {
      assets: _assets,
      adapter: _adapter,
      command: _command,
      configFile: _configFile,
      cwd: _cwd,
      devCommand: _devCommand,
      imagesBinding: _imagesBinding,
      memo: _memo,
      outdir: _outdir,
      sessionBinding: _sessionBinding,
      ...workerProps
    } = props;

    // ---- dev mode -------------------------------------------------------
    // Skip the build, generate the wrangler config the Cloudflare Vite plugin
    // behind `astro dev` needs in order to emulate the stack's bindings, and
    // hand the Worker over to the external dev server.
    if (ctx.dev) {
      return yield* makeAstroDev({
        id,
        props,
        workerProps,
        root,
        outdir,
        configFile,
        adapterOptions,
        compatibility,
        runnerDir,
      });
    }

    return yield* makeAstroBuild({
      id,
      props,
      workerProps,
      root,
      outdir,
      main,
      configFile,
      adapterOptions,
      compatibility,
      runnerDir,
    });
  });

/** Everything both branches need, derived once by {@link makeAstro}. */
interface BranchArgs {
  id: string;
  props: AstroProps<any>;
  workerProps: Record<string, unknown>;
  root: string;
  outdir: string;
  configFile: string | false;
  adapterOptions: Record<string, unknown>;
  compatibility: { date: string; flags: string[] };
  runnerDir: string;
}

/**
 * `alchemy dev`: skip the build, generate the wrangler config the Cloudflare
 * Vite plugin behind `astro dev` needs in order to emulate the stack's
 * bindings, and hand the Worker over to the external dev server.
 */
const makeAstroDev = Effect.fn(function* (args: BranchArgs) {
  const {
    id,
    props,
    workerProps,
    root,
    outdir,
    configFile,
    adapterOptions,
    compatibility,
    runnerDir,
  } = args;

  const { arrays, vars, varOutputs, workerBindings, skipped } = yield* collectDevBindings(
    props.env ?? {},
  );

  const configPath = nodePath.join(root, ".dev.wrangler.json");
  const bridgeDir = nodePath.join(root, ".dev.registry");
  // Mirrors `Paths.state("alchemy", "registry")` in cloudflare-runtime,
  // which is internal and so cannot be imported. It resolves XDG_STATE_HOME
  // FIRST — miss that and on any machine that sets it we silently read an
  // empty directory and the service binding just never appears.
  // ASTRO_ALCHEMY_REGISTRY is a local override; alchemy does not read it.
  const alchemyRegistry =
    process.env.ASTRO_ALCHEMY_REGISTRY ??
    nodePath.join(
      process.env.XDG_STATE_HOME ?? nodePath.join(process.env.HOME ?? ".", ".local", "state"),
      "alchemy",
      "registry",
    );

  const baseConfig = {
    name: `${id.toLowerCase()}-dev`,
    compatibility_date: compatibility.date,
    compatibility_flags: compatibility.flags,
    ...arrays,
    vars,
  };

  // ---- dev registry bridge -------------------------------------------
  // Alchemy runs workerd DIRECTLY (no miniflare) and writes its dev
  // registry to `Paths.state("alchemy","registry")`:
  //   { scriptName, debugPortAddress, services:[{kind,fetchService,rpcService}] }
  // Miniflare reads a registry too, at `WRANGLER_REGISTRY_PATH`, shaped:
  //   { debugPortAddress, defaultEntrypointService, userWorkerService }
  // Same protocol generation (workerd debug port + service names), so a
  // mechanical translation lets `astro dev` bind to Alchemy's local
  // Workers with no upstream patch and no cloud round-trip.
  //
  // This runs inside `Output.map` because the physical worker names only
  // resolve at reconcile — which is also when the local workers are up and
  // their registry entries exist. Output-valued vars ride the same wait for
  // the same reason: nothing that needs RuntimeContext can resolve earlier.
  // Sync `node:fs` here is a deliberate wart: the mapper is a plain function,
  // not an Effect.
  //
  // One `Output.all` over `[...worker names, ...var values]` rather than two
  // waits: the config is written once, so both halves must be in hand at the
  // same moment. The callback splits the result back at `workerBindings.length`.
  const ready = Output.map(
    // `Output.all`'s return type collapses for a spread ARRAY: its `All<>`
    // helper only builds a tuple when the length is a literal, and
    // otherwise reports `Output<V>` — while the runtime is `Effect.all`,
    // which always resolves to an array. So the cast corrects an upstream
    // type, and the callback below is typed off the runtime truth.
    Output.all(
      ...workerBindings.map((w) => w.name),
      ...varOutputs.map((v) => v.value),
    ) as unknown as Output.Output<string[]>,
    (resolved: string[]) => {
      const scriptNames = resolved.slice(0, workerBindings.length);
      const varValues = resolved.slice(workerBindings.length);

      nodeFs.mkdirSync(bridgeDir, { recursive: true });
      const services = workerBindings.flatMap(({ binding }, i) => {
        const service = scriptNames[i]!;
        return bridgeRegistryEntry(alchemyRegistry, bridgeDir, service)
          ? [{ binding, service }]
          : [];
      });
      nodeFs.writeFileSync(
        configPath,
        `${JSON.stringify(
          {
            ...baseConfig,
            vars: {
              ...vars,
              ...Object.fromEntries(varOutputs.map(({ name }, i) => [name, varValues[i]!])),
            },
            ...(services.length ? { services } : {}),
          },
          null,
          2,
        )}\n`,
      );
      return bridgeDir;
    },
  );

  if (skipped.length > 0) {
    yield* Effect.logWarning(
      `[${id}] dev: no astro-dev equivalent for binding(s) ${skipped.join(", ")}`,
    );
  }

  // Alchemy owns the dev config path too — the app's astro.config no
  // longer needs a `configPath` line.
  const devRunner = nodePath.join(runnerDir, "astro-dev.mjs");
  // Only when we own the command — see the build branch.
  if (props.devCommand === undefined) {
    writeRunner({
      mode: "dev",
      file: devRunner,
      root,
      outDir: outdir,
      configFile,
      adapter: { ...adapterOptions, configPath },
    });
  }

  const devCmd = yield* Command.Dev("Dev", {
    command: props.devCommand ?? `node ${nodePath.relative(root, devRunner)}`,
    cwd: root,
    env: {
      // No ASTRO_DEV_BACKGROUND needed: the runner calls astro's `dev()`
      // directly, so there is no CLI to daemonize and outlive the stack.
      // Point miniflare's dev registry at the bridged Alchemy entries.
      // The CF vite plugin calls miniflare's getDefaultDevRegistryPath(),
      // which reads MINIFLARE_REGISTRY_PATH. `wrangler dev` reads
      // WRANGLER_REGISTRY_PATH instead — set both so either host works.
      MINIFLARE_REGISTRY_PATH: ready,
      WRANGLER_REGISTRY_PATH: ready,
    },
  }).pipe(Namespace.push(id));

  return yield* Cloudflare.Worker<any, WorkerAssetsConfig>(id, {
    ...workerProps,
    main: undefined!,
    // The external dev server owns the process; Alchemy starts no workerd.
    dev: { mode: "external", url: devCmd.url },
  });
});

/** `alchemy deploy`: build through Astro's Node API, then upload. */
const makeAstroBuild = Effect.fn(function* (args: BranchArgs & { main: string }) {
  const {
    id,
    props,
    workerProps,
    root,
    outdir,
    main,
    configFile,
    adapterOptions,
    compatibility,
    runnerDir,
  } = args;

  // Namespace ONLY the Build. Wrapping the whole resource in
  // `Namespace.push(id)` (as Website.StaticSite does) resolves `env` inside
  // that namespace, so every resource referenced there is re-created as a
  // duplicate (`Site/ApiWorker` alongside the stack's `ApiWorker`).
  // Website.Vite avoids this by passing the caller's id straight to Worker.
  const buildRunner = nodePath.join(runnerDir, "astro-build.mjs");
  // Only when we own the command — otherwise we'd write a module nobody runs
  // into the user's app root and mislead whoever reads it while debugging.
  if (props.command === undefined) {
    writeRunner({
      mode: "build",
      file: buildRunner,
      root,
      outDir: outdir,
      configFile,
      adapter: adapterOptions,
    });
  }

  const build = yield* Command.Build("Build", {
    command: props.command ?? `node ${nodePath.relative(root, buildRunner)}`,
    cwd: root,
    outdir,
    // The runner lives in `.alchemy/`, which callers gitignore (the README
    // tells them to), and Build hashes only NON-gitignored files. So the
    // adapter options baked into it are invisible to the memo: change
    // `sessionBinding` or `adapter.imageService` and an unchanged hash would
    // skip the rebuild and ship the old config, silently. Feed them through
    // `env`, which Build folds into the hash.
    env: { ASTRO_ALCHEMY_CONFIG: JSON.stringify({ adapterOptions, configFile, outdir }) },
    // `hashDirectory` collects ancestor .gitignore rules but applies them as
    // globs relative to `cwd`, so this package's `test/fixture/.astro/` never
    // matches anything. Exclude what this resource generates, explicitly.
    memo: props.memo ?? {
      exclude: [
        ".astro/**",
        ".alchemy/**",
        ".dev.registry/**",
        ".dev.wrangler.json",
        `${outdir}/**`,
      ],
    },
  }).pipe(Namespace.push(id));

  return yield* Cloudflare.Worker<any, WorkerAssetsConfig>(id, {
    ...workerProps,
    main,
    bundle: false,
    assets: {
      // `build.outdir` is relative to process.cwd() (Command.Build stores it
      // that way so state is portable across machines).
      directory: Output.map(build.outdir, (d) => `${d}/client`),
      // AssetsWithHash.hash is typed `string` — use the output-tree hash so
      // an unchanged build is a genuine no-op.
      hash: Output.map(build.hash, (h) => h.output ?? h.input ?? ""),
      ...props.assets,
    },
    compatibility,
  });
});
