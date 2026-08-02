/**
 * The live suite. §14's list, against the real Worker: the real npm install,
 * the real language service, the real esbuild, the real Durable Object and a
 * real R2 bucket.
 *
 * `dev: true` runs the Worker locally under workerd rather than deploying it,
 * which is what makes the whole file a sub-minute loop instead of a cloud round
 * trip per assertion. Nothing measured is faked by it: the registry fetches,
 * the `@types` that come back, the diagnostics, the bundle and the published
 * bytes are all the product's own. Set `ALCHEMY_DEV=0` to run the same suite
 * against a deploy.
 *
 * `create` is driven over **MCP**, because that is the only surface it has —
 * `api.ts` reads and mutates metadata but cannot publish a version. The
 * framing costs one helper (`callTool`) and buys the tool schema, the
 * `isError` convention and the JSON result shape being exercised as the agent
 * sees them.
 */

import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { TARGET_HEADER } from "./Origin.ts";
import Stack, { ARTIFACT_SUFFIX, SHELL_ORIGIN, STAGE } from "./Stack.ts";

const DEV = process.env["ALCHEMY_DEV"] !== "0";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Alchemy.localState(),
  stage: STAGE,
  profile: "dev",
  dev: DEV,
});

const deployStartedAt = Date.now();
const stack = beforeAll(deploy(Stack), { timeout: 900_000 });

/** Leaving the bucket and the DO up is a defect, so teardown is not optional. */
afterAll.skipIf(!!process.env["NO_DESTROY"])(destroy(Stack), { timeout: 600_000 });

/**
 * The public artifact origin serves under `dev: true` as well as on a deploy:
 * `serve.ts` degrades to no caching when workerd has no Cache API bound, rather
 * than throwing before it serves anything.
 */
const PUBLIC_ORIGIN_SERVES = true;

// ── fixtures ───────────────────────────────────────────────────────────────

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>integ mezes</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./client.js"></script>
  </body>
</html>
`;

const CLIENT = `import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const mount = document.getElementById("root");
if (mount === null) throw new Error("public/index.html has no #root to mount into");

createRoot(mount).render(<App />);
`;

/**
 * The eleven patterns §14 names, in one tree: `useRef<HTMLDivElement>(null)`,
 * `useState()` with no argument, a type-only import, `React.FC`, `forwardRef`,
 * `useId`, `useTransition`, `Suspense`, `lazy`, `createPortal`, `createRoot`
 * (in `src/client.tsx`). Every one of them is correct React, and every one is
 * a false diagnostic waiting to happen if the install did not land real
 * declarations — which is the assertion this file exists for.
 */
const APP = `import * as React from "react";
import { forwardRef, lazy, Suspense, useId, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

const Badge: React.FC<{ label: string }> = ({ label }) => <span>{label}</span>;

const Field = forwardRef<HTMLInputElement, { name: string }>((props, ref) => (
  <input ref={ref} name={props.name} />
));

const Late = lazy(async () => ({ default: () => <p>late</p> }));

const wrap = (children: ReactNode): ReactNode => <div className="wrap">{children}</div>;

export const App = () => {
  const box = useRef<HTMLDivElement>(null);
  const [maybe] = useState();
  const [pending, start] = useTransition();
  const id = useId();

  return (
    <main ref={box} id={id}>
      <h1>integ mezes</h1>
      {wrap(<Badge label="ready" />)}
      <Field name="who" />
      <Suspense fallback={<p>loading</p>}>
        <Late />
      </Suspense>
      <button onClick={() => start(() => {})}>{pending ? "working" : "go"}</button>
      <p>{String(maybe)}</p>
      {typeof document === "undefined" ? null : createPortal(<i />, document.body)}
    </main>
  );
};
`;

const REACT_MEZES: Record<string, string> = {
  "public/index.html": INDEX_HTML,
  "src/client.tsx": CLIENT,
  "src/App.tsx": APP,
};

/** `maxLength` is `number` in the real DOM declarations and `any` in a stub. */
const WRONG_DOM_PROP = `export const App = () => <input maxLength="ten" readOnly />;
`;

/** A dependency array that is not a list — only real declarations catch it. */
const WRONG_EFFECT_DEPS = `import { useEffect, useState } from "react";

export const App = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount((n) => n + 1);
  }, "count");
  return <p>{count}</p>;
};
`;

/**
 * Declared in `dependencies` and absent from the registry. It clears
 * `undeclaredImports` (it IS declared) and clears the language service (`2307`
 * is suppressed as a resolution code), so the build stage is the only thing
 * left that can reject it.
 */
const ABSENT_PACKAGE = "totally-not-a-real-package-xyzzy";

const IMPORTS_ABSENT_PACKAGE = `import { thing } from "${ABSENT_PACKAGE}";

export const App = () => <p>{String(thing)}</p>;
`;

// ── the surfaces ───────────────────────────────────────────────────────────

interface Stack {
  readonly url: string;
  readonly vantage: string;
  readonly artifactSuffix: string;
}

interface Answer {
  readonly status: number;
  readonly contentType: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const answer =
  (response: { status: number; headers: Record<string, string> }) =>
  (body: string): Answer => ({
    status: response.status,
    contentType: response.headers["content-type"] ?? "",
    headers: response.headers,
    body,
  });

/**
 * The Worker's own URL, joined to a path. In dev alchemy reports it with a
 * trailing slash and on workers.dev without one, so neither end may assume.
 */
const at = (base: string, path: string): string => `${base.replace(/\/+$/, "")}/${path}`;

/**
 * The plain client, deliberately: `Test.executeWhenReady` retries 404s and 5xx
 * through the cold-start window, and half of what this suite asserts IS a 404.
 */
const send = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(request);
    return answer(response)(yield* response.text);
  });

/** JSON-RPC over the MCP endpoint. The stateless handler answers as one SSE frame. */
const rpc = (url: string, method: string, params: Record<string, unknown>) =>
  Effect.gen(function* () {
    const response = yield* send(
      HttpClientRequest.post(at(url, "mcp")).pipe(
        HttpClientRequest.setHeaders({
          // Both, per the Streamable HTTP transport: the server picks.
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
        }),
        HttpClientRequest.setBody(HttpBody.jsonUnsafe({ jsonrpc: "2.0", id: 1, method, params })),
      ),
    );
    expect(response.status).toBe(200);
    return frame(response) as { result?: unknown; error?: { message: string } };
  });

/** `event: message\ndata: {…}` when the transport chose SSE, plain JSON otherwise. */
const frame = (response: Answer): unknown => {
  if (!response.contentType.includes("text/event-stream")) {
    return JSON.parse(response.body) as unknown;
  }
  const data = response.body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  const last = data.at(-1);
  if (last === undefined) throw new Error(`no SSE data frame in: ${response.body.slice(0, 400)}`);
  return JSON.parse(last) as unknown;
};

interface ToolResult {
  readonly isError: boolean;
  readonly value: unknown;
}

/** A tool's JSON payload rides in `content[0].text`; a rejection sets `isError`. */
const callTool = (url: string, name: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const envelope = yield* rpc(url, "tools/call", { name, arguments: args });
    if (envelope.error !== undefined) {
      throw new Error(`${name} failed at the protocol level: ${envelope.error.message}`);
    }
    const result = envelope.result as {
      isError?: boolean;
      content?: readonly { type: string; text: string }[];
    };
    const text = result.content?.[0]?.text;
    if (text === undefined) throw new Error(`${name} returned no text content`);
    return { isError: result.isError === true, value: JSON.parse(text) as unknown } as ToolResult;
  });

type Created =
  | { readonly ok: true; readonly slug: string; readonly version: number; readonly url: string }
  | {
      readonly ok: false;
      readonly stage: "install" | "typecheck" | "build";
      readonly diagnostics: readonly {
        kind: string;
        file: string;
        line: number;
        column: number;
        message: string;
        code?: number;
      }[];
    };

const create = (url: string, args: Record<string, unknown>, label: string) =>
  Effect.gen(function* () {
    const started = Date.now();
    const { isError, value } = yield* callTool(url, "create", args);
    const result = value as Created;
    console.log(
      `create(${label}): ok=${result.ok}${result.ok ? ` v${result.version}` : ` stage=${result.stage}`} in ${Date.now() - started}ms`,
    );
    if (!result.ok) {
      for (const diagnostic of result.diagnostics) {
        console.log(
          `  ${diagnostic.kind} ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} TS${diagnostic.code ?? "-"} ${diagnostic.message.split("\n")[0]}`,
        );
      }
    }
    // The failure channel is the result, never a protocol error: a model that
    // cannot read the diagnostics cannot correct itself.
    expect(isError).toBe(!result.ok);
    return result;
  });

const inspect = (url: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const { isError, value } = yield* callTool(url, "inspect", args);
    expect(isError).toBe(false);
    return value as {
      slug: string;
      version: number;
      files: readonly { path: string; sha: string; bytes: number }[];
      contents?: Record<string, string>;
    };
  });

interface MezesDetail {
  readonly slug: string;
  readonly head: number;
  readonly visibility: "private" | "public";
  readonly versions: readonly { n: number }[];
}

const detail = (url: string, slug: string) =>
  Effect.gen(function* () {
    const response = yield* send(HttpClientRequest.get(at(url, `api/mezedes/${slug}`)));
    expect(response.status).toBe(200);
    return JSON.parse(response.body) as MezesDetail;
  });

const setVisibility = (url: string, slug: string, visibility: "private" | "public") =>
  Effect.gen(function* () {
    const response = yield* send(
      HttpClientRequest.patch(at(url, `api/mezedes/${slug}`)).pipe(
        HttpClientRequest.setBody(HttpBody.jsonUnsafe({ visibility })),
      ),
    );
    expect(response.status).toBe(200);
    return JSON.parse(response.body) as MezesDetail;
  });

/** What a browser sends. The single-page fallback is gated on it. */
const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

/**
 * A preview, the way the shell reaches one: mint the capability through `/api`
 * — which `AUTH: "none"` leaves open here — then request the ORIGIN it names.
 * There is no `/preview/` path any more, deliberately: a preview under the
 * shell's hostname gives the frame an opaque origin, whose module-script
 * fetches carry no credentials and which any gate on that hostname refuses.
 */
const preview = (
  url: string,
  slug: string,
  version: number,
  path: string,
  accept = BROWSER_ACCEPT,
) =>
  Effect.gen(function* () {
    const { vantage } = (yield* stack) as Stack;
    const minted = yield* send(
      HttpClientRequest.get(at(url, `api/mezedes/${slug}/v/${version}/preview`)).pipe(
        HttpClientRequest.setHeaders({ Accept: "application/json" }),
      ),
    );
    const host = new URL((JSON.parse(minted.body) as { url: string }).url).hostname;
    return yield* origin(vantage, host, `/${path}`, accept);
  });

/**
 * The public artifact origin, addressed by hostname. See `Vantage.ts` for why
 * the request goes through a service binding rather than a `Host` header.
 */
const origin = (vantage: string, host: string, path = "/", accept = BROWSER_ACCEPT) =>
  send(
    HttpClientRequest.get(vantage).pipe(
      HttpClientRequest.setHeaders({ [TARGET_HEADER]: `https://${host}${path}`, Accept: accept }),
    ),
  );

const MOUNT = `<div id="root"></div>`;

// ── 1. the Worker is up, and needs no token ────────────────────────────────

test(
  "the Worker serves the shell and the index with no Access token at all",
  Effect.gen(function* () {
    const { url, vantage } = (yield* stack) as Stack;
    console.log(`deploy wall time: ${((Date.now() - deployStartedAt) / 1000).toFixed(1)}s`);
    console.log(`worker: ${url}  vantage: ${vantage}`);

    const shell = yield* Test.executeWhenReady(HttpClientRequest.get(url));
    expect(shell.status).toBe(200);
    // `AUTH: "none"` composes the gate out; anything else is a 401 from `refused`.
    expect(shell.headers["x-mezedes-denial"]).toBeUndefined();
    expect(yield* shell.text).toContain("<!doctype html>");

    // The index, through the DO. On a real deploy the namespace is minutes-old
    // and a call can land before its class has propagated ("The RPC receiver
    // does not implement the method"), so the wait belongs here rather than in
    // every test that follows. In dev this answers first time.
    const index = yield* Test.executeWhenReady(HttpClientRequest.get(at(url, "api/mezedes")));
    expect(index.status).toBe(200);
    expect(JSON.parse(yield* index.text)).toEqual({ mezedes: [] });
  }),
  { timeout: 300_000 },
);

// ── 2. THE ONE THAT MATTERS MOST — the install produces real types ─────────

/**
 * A missing type declaration is not an install warning: with `@types/react`
 * one directory too deep (§16's `hoistPackageRoots` hazard) the language
 * service simply sees nothing, every React value is implicitly untyped, and
 * BOTH halves of this test flip at once — the good tree keeps passing while
 * the mistakes stop being caught. So the codes are asserted exactly, and
 * "typechecks" and "still catches" are asserted together.
 */
test(
  "a create typechecks idiomatic React against the REAL @types and catches TS2322 / TS2345",
  Effect.gen(function* () {
    const { url } = (yield* stack) as Stack;

    const good = yield* create(
      url,
      {
        slug: "integ-react",
        name: "integ react",
        description: "the live suite's React mezes",
        files: REACT_MEZES,
        note: "v1",
      },
      "idiomatic react",
    );
    // Zero diagnostics over eleven idiomatic patterns. A stub — or a hoist
    // regression that leaves the service with no declarations at all — takes
    // this out with a false `semantic` diagnostic on correct code.
    expect(good).toEqual({
      ok: true,
      slug: "integ-react",
      version: 1,
      url: `https://integ-react.${ARTIFACT_SUFFIX}`,
    });

    const wrongProp = yield* create(
      url,
      { slug: "integ-react", files: { ...REACT_MEZES, "src/App.tsx": WRONG_DOM_PROP } },
      'maxLength="ten"',
    );
    expect(wrongProp.ok).toBe(false);
    if (wrongProp.ok) throw new Error("unreachable");
    expect(wrongProp.stage).toBe("typecheck");
    // TS2322 — `string` is not assignable to `number`. THE discriminator:
    // `react-lib.ts`'s fallback declares `IntrinsicElements` as
    // `[name: string]: any`, so under the stub — or under a hoist regression
    // that leaves the service with no declarations at all — this ships green
    // and fails in the browser instead.
    expect(wrongProp.diagnostics.map((d) => d.code)).toContain(2322);
    expect(wrongProp.diagnostics.map((d) => d.file)).toContain("src/App.tsx");
    expect(wrongProp.diagnostics.every((d) => d.kind === "semantic")).toBe(true);

    const wrongDeps = yield* create(
      url,
      { slug: "integ-react", files: { ...REACT_MEZES, "src/App.tsx": WRONG_EFFECT_DEPS } },
      "useEffect deps",
    );
    expect(wrongDeps.ok).toBe(false);
    if (wrongDeps.ok) throw new Error("unreachable");
    expect(wrongDeps.stage).toBe("typecheck");
    // TS2345 — a `string` where `DependencyList` was expected. §7 names this
    // one alongside the wrong prop; unlike it, the stub would catch it too
    // (its `deps?: readonly MezedesNode[]` still refuses a string), so it pins
    // the code rather than the source of the declarations.
    expect(wrongDeps.diagnostics.map((d) => d.code)).toContain(2345);
  }),
  { timeout: 900_000 },
);

// ── 3. create, end to end ─────────────────────────────────────────────────

/**
 * The other half of "installs, typechecks, builds, publishes, and the returned
 * URL serves": the bytes that landed. It is asserted through `/preview/`, which
 * resolves the SAME published manifest through the SAME asset storage and the
 * same asset → isolate → fallback ordering as the public origin — and, unlike
 * the public origin, works under `dev: true` because it never touches the Cache
 * API. The `url` `create` returned is asserted above; that URL serving these
 * bytes is asserted on the public origin further down, where it can be.
 */
test(
  "the published version serves the mount node and its React bundle",
  Effect.gen(function* () {
    const { url } = (yield* stack) as Stack;

    const page = yield* preview(url, "integ-react", 1, "");
    console.log(`preview v1: ${page.status} ${page.contentType} ${page.body.length} bytes`);
    expect(page.status).toBe(200);
    expect(page.contentType).toContain("text/html");
    expect(page.body).toContain(MOUNT);
    expect(page.body).toContain(`src="./client.js"`);
    // The frame is the defence; this is the one that survives the URL being
    // opened outside it. `frame-ancestors` rides along in the same header,
    // because a second Content-Security-Policy would replace this one rather
    // than add to it.
    expect(page.headers["content-security-policy"]).toBe(
      `sandbox allow-scripts; frame-ancestors 'self' ${SHELL_ORIGIN}`,
    );

    const bundle = yield* preview(url, "integ-react", 1, "client.js", "*/*");
    console.log(`preview v1 client.js: ${bundle.status} ${bundle.body.length} bytes`);
    expect(bundle.status).toBe(200);
    expect(bundle.contentType).toContain("javascript");
    // A real React 19 client bundle, minified, with the production branch
    // substituted in — not a stub and not the development build.
    expect(bundle.body.length).toBeGreaterThan(100_000);
    // The mezes's own markup, so this is its bundle and not a stray asset.
    expect(bundle.body).toContain("integ mezes");
    // React's PRODUCTION build: `define` substituted `process.env.NODE_ENV`
    // at bundle time, so the development build's warning machinery — a
    // megabyte of it — is gone and only the minified error index remains.
    expect(bundle.body).toContain("Minified React error");
    expect(bundle.body).not.toContain("process.env.NODE_ENV");
  }),
  { timeout: 300_000 },
);

// ── 4. a rejection writes nothing ─────────────────────────────────────────

test(
  "a build failure and a type error each create no version, and v1 keeps serving",
  Effect.gen(function* () {
    const { url } = (yield* stack) as Stack;

    const before = yield* detail(url, "integ-react");
    const served = yield* preview(url, "integ-react", 1, "");
    expect(before.versions).toHaveLength(1);

    const broken = yield* create(
      url,
      {
        slug: "integ-react",
        files: { ...REACT_MEZES, "src/App.tsx": IMPORTS_ABSENT_PACKAGE },
        dependencies: { [ABSENT_PACKAGE]: "^1.0.0" },
      },
      "declared package that does not exist",
    );
    expect(broken.ok).toBe(false);
    if (broken.ok) throw new Error("unreachable");
    // `typecheck`, not `build`: the package IS declared, so `undeclaredImports`
    // passes it — but the install cannot produce it and the language service
    // then raises TS2307, which is reported rather than suppressed. Catching it
    // here rather than in the bundler is one stage earlier and names the file.
    expect(broken.stage).toBe("typecheck");
    expect(broken.diagnostics.some((d) => d.kind === "resolution")).toBe(true);

    const typeError = yield* create(
      url,
      { slug: "integ-react", files: { ...REACT_MEZES, "src/App.tsx": WRONG_DOM_PROP } },
      "type error against a live mezes",
    );
    expect(typeError.ok).toBe(false);

    const after = yield* detail(url, "integ-react");
    // The number that matters: no version was allocated, and head did not move.
    expect(after.versions.map((v) => v.n)).toEqual(before.versions.map((v) => v.n));
    expect(after.head).toBe(before.head);

    const still = yield* preview(url, "integ-react", 1, "");
    expect(still.status).toBe(200);
    expect(still.body).toBe(served.body);

    const live = yield* inspect(url, { slug: "integ-react", paths: ["src/App.tsx"] });
    expect(live.version).toBe(1);
    expect(live.contents?.["src/App.tsx"]).toBe(APP);
  }),
  { timeout: 900_000 },
);

// ── 5. privacy ────────────────────────────────────────────────────────────

test(
  "a private mezes renders through /preview/ while the public host is still private",
  Effect.gen(function* () {
    const { url } = (yield* stack) as Stack;

    const mezes = yield* detail(url, "integ-react");
    // Never supplied, never toggled: a new mezes starts private.
    expect(mezes.visibility).toBe("private");

    const page = yield* preview(url, "integ-react", 1, "");
    expect(page.status).toBe(200);
    expect(page.body).toContain(MOUNT);
    // Nothing about a private mezes may sit in a PoP cache keyed by a URL that
    // Access, not this Worker, decides who may request.
    expect(page.headers["cache-control"]).toBe("no-store");
  }),
  { timeout: 300_000 },
);

test.skipIf(!PUBLIC_ORIGIN_SERVES)(
  "a private mezes 404s on the public artifact host, and serves once it is public",
  Effect.gen(function* () {
    const { url, vantage } = (yield* stack) as Stack;

    // Every path on an artifact host belongs to the origin, not to the shell:
    // `entry.ts` matches the hostname before it looks at anything else.
    const swallowed = yield* origin(vantage, `integ-react.${ARTIFACT_SUFFIX}`, "/api/mezedes");
    expect(swallowed.status).toBe(404);

    const hidden = yield* origin(vantage, `integ-react.${ARTIFACT_SUFFIX}`);
    console.log(
      `public origin while private: ${hidden.status} ${JSON.stringify(hidden.body.slice(0, 80))}`,
    );
    // The same answer a slug that does not exist gets: the public origin never
    // confirms that a private slug is taken.
    expect(hidden.status).toBe(404);

    const missing = yield* origin(vantage, `no-such-mezes.${ARTIFACT_SUFFIX}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toBe(hidden.body);

    yield* setVisibility(url, "integ-react", "public");

    const shown = yield* origin(vantage, `integ-react.${ARTIFACT_SUFFIX}`);
    expect(shown.status).toBe(200);
    expect(shown.body).toContain(MOUNT);
    expect(shown.headers["x-content-type-options"]).toBe("nosniff");
  }),
  { timeout: 300_000 },
);

// ── 6. versioning ─────────────────────────────────────────────────────────

const V2_APP = `export const App = () => (
  <main>
    <h1>integ mezes v2</h1>
  </main>
);
`;

test(
  "a second create with a subset of files carries the rest, and v1 keeps its own bytes",
  Effect.gen(function* () {
    const { url } = (yield* stack) as Stack;

    const first = yield* preview(url, "integ-react", 1, "");
    const firstBundle = yield* preview(url, "integ-react", 1, "client.js", "*/*");

    // Only `src/App.tsx`. `public/index.html` and `src/client.tsx` must carry.
    const second = yield* create(
      url,
      { slug: "integ-react", files: { "src/App.tsx": V2_APP }, note: "v2" },
      "subset over v1",
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.version).toBe(2);

    const v2 = yield* inspect(url, {
      slug: "integ-react",
      paths: ["public/index.html", "src/client.tsx", "src/App.tsx"],
    });
    expect(v2.version).toBe(2);
    // The unsupplied files are the SAME bytes, not a re-send.
    expect(v2.contents?.["public/index.html"]).toBe(INDEX_HTML);
    expect(v2.contents?.["src/client.tsx"]).toBe(CLIENT);
    expect(v2.contents?.["src/App.tsx"]).toBe(V2_APP);
    // Carried through the merge unchanged means carried at the same address.
    const v1 = yield* inspect(url, { slug: "integ-react", version: 1 });
    const shaOf = (files: readonly { path: string; sha: string }[], path: string) =>
      files.find((file) => file.path === path)?.sha;
    expect(shaOf(v2.files, "public/index.html")).toBe(shaOf(v1.files, "public/index.html"));
    expect(shaOf(v2.files, "src/App.tsx")).not.toBe(shaOf(v1.files, "src/App.tsx"));

    const v2Page = yield* preview(url, "integ-react", 2, "");
    expect(v2Page.status).toBe(200);
    expect(v2Page.body).toBe(first.body);

    const v2Bundle = yield* preview(url, "integ-react", 2, "client.js", "*/*");
    expect(v2Bundle.status).toBe(200);
    expect(v2Bundle.body).not.toBe(firstBundle.body);

    // v1 is immutable end to end: same page, same bundle, forever.
    const stillV1 = yield* preview(url, "integ-react", 1, "client.js", "*/*");
    expect(stillV1.status).toBe(200);
    expect(stillV1.body).toBe(firstBundle.body);

    const detailAfter = yield* detail(url, "integ-react");
    expect(detailAfter.head).toBe(2);
    expect(detailAfter.versions.map((v) => v.n)).toEqual([2, 1]);
  }),
  { timeout: 900_000 },
);

// ── 7. the Worker Loader path ─────────────────────────────────────────────

/**
 * The only mezes in this suite with a server entry, and therefore the only one
 * that loads a Dynamic Worker at all. Everything above publishes
 * `mainModule: null` and is served entirely from R2 — which is the cheap and
 * common case, and is why this one is exercised separately.
 *
 * It answers `/` too, so the asset-before-isolate ordering has something to be
 * wrong about: if the isolate ran first, the page below would be this string
 * rather than the seeded HTML.
 */
const SERVER_ENTRY = `export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("SERVED BY THE ISOLATE", { headers: { "content-type": "text/html" } });
    }
    if (url.pathname === "/api/ping") {
      return Response.json({ from: "isolate" });
    }
    // Whether the isolate holds any binding at all.
    if (url.pathname === "/api/env") {
      return Response.json({ keys: Object.keys(env ?? {}) });
    }
    // Whether it can reach the network. \`globalOutbound: null\` must make this throw.
    if (url.pathname === "/api/egress") {
      try {
        const reached = await fetch("https://example.com/");
        return Response.json({ escaped: true, status: reached.status });
      } catch (cause) {
        return Response.json({ escaped: false, message: String(cause).slice(0, 120) });
      }
    }
    // Everything else is disclaimed, so the single-page fallback gets its turn.
    return new Response("not mine", { status: 404 });
  },
};
`;

test(
  "a mezes with a server entry loads an isolate, and the isolate is sealed",
  Effect.gen(function* () {
    const { url } = (yield* stack) as Stack;

    const made = yield* create(
      url,
      {
        name: "integ server",
        description: "exercises the Worker Loader path",
        files: { ...REACT_MEZES, "src/server.ts": SERVER_ENTRY },
      },
      "server entry",
    );
    expect(made.ok).toBe(true);
    if (!made.ok) throw new Error("unreachable");
    const slug = made.slug;

    // 1. The isolate answers a route it owns. Nothing else in this suite can.
    const ping = yield* preview(url, slug, 1, "api/ping", "*/*");
    console.log(`isolate /api/ping: ${ping.status} ${ping.body.slice(0, 60)}`);
    expect(ping.status).toBe(200);
    expect(JSON.parse(ping.body)).toEqual({ from: "isolate" });

    // 2. Assets win. The server answers "/" too, and must not get the chance.
    const root = yield* preview(url, slug, 1, "");
    expect(root.status).toBe(200);
    expect(root.body).toContain(MOUNT);
    expect(root.body).not.toContain("SERVED BY THE ISOLATE");

    // 3. A route the isolate disclaims reaches the single-page fallback.
    const deep = yield* preview(url, slug, 1, "some/client/route");
    expect(deep.status).toBe(200);
    expect(deep.body).toContain(MOUNT);

    // 4. ...but only for something that asked for HTML. A missing subresource
    //    still 404s honestly rather than silently becoming a page.
    const subresource = yield* preview(url, slug, 1, "missing.png", "image/avif,image/webp,*/*");
    expect(subresource.status).toBe(404);
    expect(subresource.body).not.toContain(MOUNT);

    // 5. `env: {}` — the isolate holds no binding it could be confused into using.
    const bindings = yield* preview(url, slug, 1, "api/env", "*/*");
    expect(bindings.status).toBe(200);
    console.log(`isolate env keys: ${bindings.body}`);
    expect((JSON.parse(bindings.body) as { keys: string[] }).keys).toEqual([]);

    // 6. `globalOutbound: null` — and it cannot reach the network either.
    const egress = yield* preview(url, slug, 1, "api/egress", "*/*");
    console.log(`isolate egress: ${egress.body.slice(0, 120)}`);
    expect(egress.status).toBe(200);
    expect((JSON.parse(egress.body) as { escaped: boolean }).escaped).toBe(false);
  }),
  { timeout: 900_000 },
);

// ── 8. search ─────────────────────────────────────────────────────────────

interface Found {
  readonly mezedes: readonly {
    slug: string;
    name: string;
    description: string;
    url: string;
    visibility: string;
    versions: number[];
    head: number;
  }[];
}

/**
 * A word that appears in nothing else here, so the FTS5 assertion below cannot
 * pass by accidentally matching another fixture.
 */
const NEEDLE = "kalamata";

/**
 * This test makes its own mezes rather than reading the ones above. Depending on
 * another test's writes makes it pass or fail on ordering, and under `dev: true`
 * the Durable Object's local state can survive between runs — so it would also
 * pass for the wrong reason, on leftovers, and fail the moment it is run alone.
 */
test(
  "search lists what exists and matches on text, and never returns contents",
  Effect.gen(function* () {
    const { url } = (yield* stack) as Stack;

    const made = yield* create(
      url,
      {
        slug: "integ-search",
        name: "integ search",
        description: `a ${NEEDLE} olive, for the full-text index`,
        files: REACT_MEZES,
      },
      "search fixture",
    );
    expect(made.ok).toBe(true);
    if (!made.ok) throw new Error("unreachable");

    const { value: all } = yield* callTool(url, "search", {});
    const listed = (all as Found).mezedes;
    console.log(`search(): ${listed.length} — ${listed.map((m) => m.slug).join(", ")}`);

    const mine = listed.find((m) => m.slug === "integ-search");
    expect(mine).toBeDefined();
    expect(mine?.head).toBe(1);
    expect(mine?.versions).toEqual([1]);
    expect(mine?.url).toContain(ARTIFACT_SUFFIX);

    // Metadata only. A model must never pay for contents it did not ask for.
    const serialised = JSON.stringify(all);
    expect(serialised).not.toContain("createRoot");
    expect(serialised).not.toContain("<!doctype html>");

    // FTS5 over the description, which no other surface in this suite reads.
    const { value: hit } = yield* callTool(url, "search", { q: NEEDLE });
    const matched = (hit as Found).mezedes;
    console.log(`search(${NEEDLE}): ${matched.map((m) => m.slug).join(", ") || "(none)"}`);
    expect(matched.map((m) => m.slug)).toEqual(["integ-search"]);

    // The porter tokenizer stems, so a prefix of the same word still finds it.
    const { value: stem } = yield* callTool(url, "search", { q: "olives" });
    expect((stem as Found).mezedes.some((m) => m.slug === "integ-search")).toBe(true);

    // A query carrying FTS5 operator syntax must not throw.
    const { value: odd } = yield* callTool(url, "search", { q: 'a" OR NEAR(' });
    expect(Array.isArray((odd as Found).mezedes)).toBe(true);
  }),
  { timeout: 300_000 },
);
