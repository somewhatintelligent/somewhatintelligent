import { expect } from "bun:test";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { fileURLToPath } from "node:url";
import ApiWorker from "./fixture/infra/ApiWorker.ts";
import { Site } from "./fixture/infra/site.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Alchemy.localState(),
});

const Stack = Alchemy.Stack(
  "AstroAlchemyFixture",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    yield* ApiWorker;
    const site = yield* Site;
    return { url: site.url.as<string>() };
  }),
);

/**
 * A fresh deploy is not ready all at once, and it fails in two distinct ways.
 *
 * 1. The script and each BINDING propagate independently, so a route can 404
 *    or 5xx for a while after `deploy` returns. `Test.getWhenReady` exists for
 *    exactly this and treats both as cold-start — a locally-written retry that
 *    only rides 404 fails the instant a not-yet-propagated KV/R2 binding 5xxs.
 *
 * 2. Alchemy serves a placeholder script while the real one uploads:
 *
 *      export default { fetch() { return new Response("Alchemy worker is being deployed...") } }
 *
 *    which answers **200**, so no status-based retry can see it. Hence the
 *    separate gate below, run once before any test.
 */
const STUB = "Alchemy worker is being deployed";

/**
 * Wait out the placeholder before a single test touches a real path.
 *
 * Each attempt carries a fresh `?__probe=` value, so the gate never reuses a
 * URL a test depends on.
 *
 * That detail is empirical, not theoretical: a run was observed where
 * `/?__probe=N` returned the real page while plain `/` returned the stub in
 * the same instant, and `/` stayed stubbed for 180s. Something keyed on the
 * exact URL was holding the stub. The obvious suspect is Workers Cache (this
 * Site enables it, and the placeholder answers 200 with no `Cache-Control`),
 * but that does not survive scrutiny — the placeholder is uploaded with no
 * `cache` metadata, and alchemy scopes Workers Cache per version unless
 * `crossVersionCache` is set. So the mechanism is UNEXPLAINED; the query
 * rotation is what made it reproducibly avoidable.
 *
 * Flat backoff, not exponential: `Schedule.exponential("1 second")` doubles,
 * so `times: N` is a 2^N-second budget — `times: 15` would be nine hours, and
 * the run would spend a 128-second sleep straddling a signal that flips in
 * under a second. Spacing evenly buys attempts instead of sleep: ~2 minutes of
 * budget with a detection lag of at most 2s.
 */
const waitForRealWorker = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    let attempt = 0;
    yield* Effect.suspend(() => client.get(`${url}/?__probe=${attempt++}`)).pipe(
      Effect.flatMap((r) => r.text),
      Effect.filterOrFail(
        (text) => text !== "" && !text.includes(STUB),
        () => new Error(`pre-create stub still being served: ${url}`),
      ),
      Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 60 }),
    );
  });

const stack = beforeAll(deploy(Stack).pipe(Effect.tap(({ url }) => waitForRealWorker(url))), {
  timeout: 300_000,
});
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack), { timeout: 300_000 });

/** Rides the 404/5xx cold-start window — see (1) above. */
const get = Test.getWhenReady;

const body = (url: string) => get(url).pipe(Effect.flatMap((r) => r.text));

test(
  "prerendered route is served by the ASSETS layer, not the Worker",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const a = yield* body(`${url}/`);
    const b = yield* body(`${url}/`);

    expect(a).toContain("static page");
    const stamp = (h: string) => h.match(/data-built-at="([^"]+)"/)?.[1];
    expect(stamp(a)).toBeDefined();
    expect(stamp(a)).toBe(stamp(b));
  }),
  { timeout: 180_000 },
);

test(
  "SSR route renders per-request on the edge",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const a = yield* body(`${url}/ssr`);
    const b = yield* body(`${url}/ssr`);

    const nonce = (h: string) => h.match(/data-nonce="([^"]+)"/)?.[1];
    expect(nonce(a)).toBeDefined();
    expect(nonce(a)).not.toBe(nonce(b));
    expect(a).toMatch(/data-colo="[A-Z]{3}"/);
  }),
  { timeout: 180_000 },
);

test(
  "nodejs_compat is applied by the stack (the adapter emits no flags of its own)",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const res = yield* get(`${url}/api/hello?echo=spike`);
    expect(res.status).toBe(200);

    const json = (yield* res.json) as Record<string, unknown>;
    expect(json.echo).toBe("spike");
    expect(json.nodeBuffer).toBe("YXN0cm8=");
  }),
  { timeout: 180_000 },
);

test(
  "Astro.session works over the Alchemy-bound SESSION KV namespace",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const page = yield* body(`${url}/counter`);
    expect(page).toMatch(/data-count="1"/);
    expect(page).toMatch(/data-error="none"/);
  }),
  { timeout: 180_000 },
);

test(
  "bindings + typed RPC into the Effect Worker reach the Astro app",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const res = yield* get(`${url}/api/bindings`);
    expect(res.status).toBe(200);

    const json = (yield* res.json) as Record<string, any>;
    // Every probe is individually caught, so a binding that throws shows up
    // here instead of collapsing the whole route into an opaque 500.
    expect(json.errors).toEqual({});
    expect(json.bindingNames).toEqual(
      expect.arrayContaining(["API", "ASSETS", "CACHE", "GREETING", "SESSION", "UPLOADS"]),
    );
    expect(json.kv).toBe("kv-ok");
    expect(json.r2).toBe("r2-ok");
    expect(json.plainVar).toBe("hello-from-alchemy");
    expect(json.serviceFetch?.from).toBe("fetch-handler");
    // Typed RPC — Effect methods called as promises from non-Effect code.
    expect(json.rpcGreet).toBe("hello astro, from the Effect worker");
    // Read back through the Effect worker's R2 capability layer.
    expect(json.rpcReadUpload).toBe("r2-ok");
  }),
  { timeout: 180_000 },
);

test(
  "content collection: prerendered index + entry pages are static assets",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const index = yield* body(`${url}/blog`);
    expect(index).toMatch(/data-count="12"/);

    const post = yield* body(`${url}/blog/post-3`);
    expect(post).toMatch(/data-post-id="post-3"/);
    // Rendered markdown body made it into the static HTML.
    expect(post).toContain("Paragraph 40 of post 3");

    // Prerendered => byte-identical across requests.
    const again = yield* body(`${url}/blog/post-3`);
    expect(again).toBe(post);
  }),
  { timeout: 180_000 },
);

test(
  "content collection read at REQUEST time + Svelte island SSR",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const a = yield* body(`${url}/ssr-content`);
    const b = yield* body(`${url}/ssr-content`);

    // Collection resolved in the Worker, not at build time.
    expect(a).toMatch(/data-count="12"/);
    expect(a).toMatch(/data-chars="7\d{4}"/);
    // ...and it is genuinely per-request.
    const nonce = (h: string) => h.match(/data-nonce="([^"]+)"/)?.[1];
    expect(nonce(a)).not.toBe(nonce(b));

    // Svelte island server-rendered with its prop applied.
    expect(a).toContain("svelte count: 7");
    expect(a).toMatch(/data-svelte-counter/);
    // Astro 7 hydrates via an INLINE <script> with dynamic imports, so the
    // island's client chunk is referenced in the script body, not a src attr.
    const chunks = [...a.matchAll(/\/_astro\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.includes("Counter"))).toBe(true);
    // ...and those chunks are really served by the ASSETS layer. Independent
    // GETs, so fetch them together rather than serializing a cold-start retry
    // budget behind each one.
    const statuses = yield* Effect.forEach(
      [...new Set(chunks)],
      (chunk) => get(`${url}${chunk}`).pipe(Effect.map((r) => r.status)),
      { concurrency: "unbounded" },
    );
    expect(statuses.every((s) => s === 200)).toBe(true);
  }),
  { timeout: 180_000 },
);

test(
  "middleware runs on SSR routes and is bypassed by prerendered assets",
  Effect.gen(function* () {
    const { url } = yield* stack;

    const ssr = yield* get(`${url}/ssr`);
    expect(ssr.headers["x-astro-middleware"]).toBe("ran");
    expect(ssr.headers["x-astro-path"]).toBe("/ssr");

    // A prerendered route is served by the ASSETS layer, so middleware
    // never sees it.
    const stat = yield* get(`${url}/blog`);
    expect(stat.headers["x-astro-middleware"]).toBeUndefined();
  }),
  { timeout: 180_000 },
);

test(
  "the generated build runner is independent of the invoking cwd",
  Effect.gen(function* () {
    // This stack lives in `test/` and the app lives in `test/fixture/`, so the
    // runner Alchemy wrote must pin an ABSOLUTE astro `root`. If it leaned on
    // the spawned process's cwd instead, the package would only build when the
    // runner happened to be invoked from the app directory.
    yield* stack;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const appRoot = path.resolve(fileURLToPath(new URL("./fixture/", import.meta.url)));

    const runner = yield* fs.readFileString(path.join(appRoot, ".alchemy", "astro-build.mjs"));
    const inline = JSON.parse(runner.match(/const inline = (\{[\s\S]*?\n\});/)![1]!) as {
      root: string;
      configFile: string;
      outDir: string;
      output: string;
    };

    expect(path.isAbsolute(inline.root)).toBe(true);
    expect(path.resolve(inline.root)).toBe(appRoot);
    // Astro does `path.join(root, configFile)`, so an absolute value here would
    // be concatenated onto the root instead of replacing it.
    expect(path.isAbsolute(inline.configFile)).toBe(false);
    // The stack owns outDir too — otherwise astro.config could send the build
    // somewhere the resource isn't looking.
    expect(inline.outDir).toBe("dist");
    expect(inline.output).toBe("server");
  }),
  { timeout: 30_000 },
);

test(
  "IMAGES binding is NOT present unless the stack binds it",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const res = yield* get(`${url}/api/images`);
    const json = (yield* res.json) as Record<string, unknown>;
    // Same shape as SESSION: the stack is the only thing that decides what is
    // bound, so an adapter that wants IMAGES still gets nothing without `env`.
    expect(json.present).toBe(false);
  }),
  { timeout: 180_000 },
);

test(
  "Astro Actions run in the Worker (success + typed ActionError)",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const client = yield* HttpClient.HttpClient;

    // `executeWhenReady` rides the same 404/5xx cold-start window as `get`,
    // and deliberately does NOT retry other 4xx — so the asserted 400 below is
    // observed immediately rather than retried away.
    const ok = yield* Test.executeWhenReady(
      HttpClientRequest.post(`${url}/_actions/echo`).pipe(
        HttpClientRequest.setHeader("content-type", "application/json"),
        HttpClientRequest.bodyText(JSON.stringify({ msg: "hi" }), "application/json"),
      ),
    );
    expect(ok.status).toBe(200);
    // Astro Actions serialize with devalue, not plain JSON:
    //   [{"echoed":1,"at":2},"HI",1785711766674]
    const payload = yield* ok.text;
    expect(payload).toContain('"echoed"');
    expect(payload).toContain('"HI"');

    const bad = yield* client.post(`${url}/_actions/boom`, {
      headers: { "content-type": "application/json" },
      body: HttpBody.text("{}", "application/json"),
    });
    expect(bad.status).toBe(400);
  }),
  { timeout: 180_000 },
);

test(
  "_redirects is honored by the assets layer",
  Effect.gen(function* () {
    const { url } = yield* stack;

    // The platform fetch under HttpClient follows redirects transparently, so
    // the 3xx itself is not observable here — assert the OUTCOME instead:
    // /old-post lands on post-1's prerendered page. (Verified out-of-band with
    // curl that the hop is a real 301 with Location: .../blog/post-1.)
    const landed = yield* body(`${url}/old-post`);
    expect(landed).toContain('data-post-id="post-1"');

    const home = yield* body(`${url}/gone`);
    expect(home).toContain("static page");
  }),
  { timeout: 180_000 },
);

test(
  "Workers Cache fronts the Worker when the cache prop is set",
  Effect.gen(function* () {
    const { url } = yield* stack;

    // Prime, then confirm repeat requests never reach the handler: the nonce
    // is generated per render, so an identical nonce means an edge cache hit.
    yield* get(`${url}/cached`);
    const nonceOf = (h: string) => h.match(/data-nonce="([^"]+)"/)?.[1];

    const stable = yield* body(`${url}/cached`).pipe(
      Effect.flatMap((first) =>
        body(`${url}/cached`).pipe(
          Effect.filterOrFail(
            (second) => nonceOf(first) === nonceOf(second),
            () => new Error("cache not warm yet"),
          ),
        ),
      ),
      Effect.retry({ schedule: Schedule.exponential("1 second"), times: 8 }),
    );
    expect(nonceOf(stable)).toBeDefined();
  }),
  { timeout: 180_000 },
);
