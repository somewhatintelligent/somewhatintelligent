import { expect } from "bun:test";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { fileURLToPath } from "node:url";
import { Site } from "./fixture/infra/site.ts";

/**
 * The dev provider writes its generated files into the Astro app root, which
 * is the fixture — NOT the working directory the test runner happens to be in.
 */
const devPath = (rel: string) => fileURLToPath(new URL(`./fixture/${rel}`, import.meta.url));

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Cloudflare.state(),
  dev: true,
});

const Stack = Alchemy.Stack(
  "AstroAlchemyFixtureDev",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const site = yield* Site;
    return { url: site.url.as<string>() };
  }),
);

const stack = beforeAll(deploy(Stack), { timeout: 300_000 });
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack), { timeout: 300_000 });

/** Vite reports its local URL WITH a trailing slash; deployed URLs have none. */
const origin = (url: string) => url.replace(/\/+$/, "");

const get = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* client
      .get(url)
      .pipe(Effect.retry({ schedule: Schedule.exponential("1 second"), times: 12 }));
  });

test(
  "dev emits a wrangler config carrying the stack's bindings",
  Effect.gen(function* () {
    yield* stack;
    const fs = yield* FileSystem.FileSystem;
    const cfg = JSON.parse(yield* fs.readFileString(devPath(".dev.wrangler.json")));

    expect(cfg.compatibility_flags).toContain("nodejs_compat");
    expect((cfg.kv_namespaces ?? []).map((k: any) => k.binding).sort()).toEqual([
      "CACHE",
      "SESSION",
    ]);
    expect((cfg.r2_buckets ?? []).map((r: any) => r.binding)).toEqual(["UPLOADS"]);
    expect(cfg.vars?.GREETING).toBe("hello-from-alchemy");
    // The sibling Alchemy Worker is now a real service binding.
    expect((cfg.services ?? []).map((s: any) => s.binding)).toEqual(["API"]);
  }),
  { timeout: 300_000 },
);

test(
  "dev bridges Alchemy's dev registry into miniflare's WorkerDefinition shape",
  Effect.gen(function* () {
    yield* stack;
    const fs = yield* FileSystem.FileSystem;

    // miniflare writes its OWN entries into this directory too
    // (`__asset-worker__`, `__router-worker__`, `site-dev`), and they satisfy
    // the same shape — so asserting on `files[0]` is a false green that passes
    // whether or not the bridge wrote anything. Assert on the exact service
    // name the generated wrangler config asks for instead.
    const cfg = JSON.parse(yield* fs.readFileString(devPath(".dev.wrangler.json")));
    const service = cfg.services?.[0]?.service as string | undefined;
    expect(service).toBeDefined();

    const files = yield* fs.readDirectory(devPath(".dev.registry"));
    // miniflare keys the registry by VERBATIM filename and writes no
    // extension, so a bridged `foo.json` registers a worker named `foo.json`
    // and the `foo` service never resolves.
    expect(files).toContain(encodeURIComponent(service!));

    const entry = JSON.parse(
      yield* fs.readFileString(devPath(`.dev.registry/${encodeURIComponent(service!)}`)),
    );
    // miniflare's WorkerDefinition fields, translated from Alchemy's
    // { scriptName, debugPortAddress, services:[{kind,fetchService,rpcService}] }
    expect(entry.debugPortAddress).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(typeof entry.defaultEntrypointService).toBe("string");
    expect(typeof entry.userWorkerService).toBe("string");
  }),
  { timeout: 300_000 },
);

test(
  "astro dev serves the app with the stack's KV, R2 and var bindings",
  Effect.gen(function* () {
    const { url } = yield* stack;
    // `url` is the astro dev server's own address (external dev mode).
    expect(url).toMatch(/^http:\/\/localhost:\d+/);

    // SSR route renders through the dev server.
    const ssr = yield* get(`${origin(url)}/ssr`);
    expect(ssr.status).toBe(200);

    // These come from the generated wrangler config, emulated by miniflare.
    // The route probes each binding independently, so the known-broken
    // service binding cannot take these down with it.
    const res = yield* get(`${origin(url)}/api/bindings`);
    const json = (yield* res.json) as Record<string, any>;
    expect(json.kv).toBe("kv-ok");
    expect(json.r2).toBe("r2-ok");
    expect(json.plainVar).toBe("hello-from-alchemy");
  }),
  { timeout: 300_000 },
);

/**
 * The end-to-end payoff of the registry bridge: `astro dev` runs under
 * miniflare, the sibling Worker runs in Alchemy's own workerd, and the service
 * binding crosses between them with no cloud round-trip.
 *
 * This was long believed impossible — the bridged entry was written as
 * `<name>.json` (alchemy's format) into a registry miniflare keys by verbatim
 * filename, so it registered a worker called `<name>.json` and the `<name>`
 * service never resolved. See `bridgeRegistryEntry` in src/Astro.ts.
 */
test(
  "astro dev reaches Alchemy's LOCAL worker over the bridged service binding",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const res = yield* get(`${origin(url)}/api/bindings`);
    const json = (yield* res.json) as Record<string, any>;
    // Empty unless a binding threw — carries the reason when it does.
    expect(json.errors).toEqual({});
    expect(json.serviceFetch?.from).toBe("fetch-handler");
    expect(json.rpcGreet).toBe("hello astro, from the Effect worker");
  }),
  { timeout: 300_000 },
);
