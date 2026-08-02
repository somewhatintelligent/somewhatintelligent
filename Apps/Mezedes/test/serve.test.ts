import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { assetKey, grantKey, liveKey, manifestKey } from "../src/core/keys.ts";
import { serveArtifact, type ServeEnv } from "../src/server/serve.ts";
import type { PublishedManifest as Manifest } from "../src/server/blobs.ts";

const SUFFIX = "a.example.com";
const SHELL = "https://mezedes.example.com";
const OWNER = "9f3c1a7b20d4e6f8";
const SLUG = "signal-garden";

/**
 * Real browser Accept headers. The bundler gates its single-page fallback on
 * `Accept: text/html`, so a synthetic `new Request(url)` carrying none makes a
 * client-side route look broken and a missing subresource look served.
 */
const NAVIGATE =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
const SUBRESOURCE = "image/avif,image/webp,image/apng,image/svg+xml,*/*;q=0.8";

const navigate = (url: string, init: RequestInit = {}): Request =>
  new Request(url, {
    ...init,
    headers: {
      Accept: NAVIGATE,
      "Accept-Language": "en-GB,en;q=0.9",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      ...(init.headers as Record<string, string> | undefined),
    },
  });

const subresource = (url: string, init: RequestInit = {}): Request =>
  new Request(url, {
    ...init,
    headers: {
      Accept: SUBRESOURCE,
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      ...(init.headers as Record<string, string> | undefined),
    },
  });

const INDEX = "<!doctype html><div id=root></div><script type=module src=./client.js></script>";
const CLIENT = "console.log('mounted');";

const manifest = (patch: Partial<Manifest> = {}): Manifest => ({
  slug: SLUG,
  version: 4,
  visibility: "public",
  owner: OWNER,
  mainModule: null,
  modules: {},
  assets: [
    ["/index.html", { contentType: "text/html; charset=utf-8", etag: "etag-index" }],
    ["/client.js", { contentType: "text/javascript; charset=utf-8", etag: "etag-client" }],
  ],
  assetConfig: { not_found_handling: "single-page-application" },
  ...patch,
});

/** Objects are minted per call: `body` is a stream and is read once. */
const bucket = (objects: Record<string, string>) => {
  const reads: string[] = [];
  return {
    reads,
    get: async (key: string) => {
      reads.push(key);
      const value = objects[key];
      if (value === undefined) return null;
      return {
        body: new Response(value).body,
        json: async () => JSON.parse(value) as unknown,
        text: async () => value,
      };
    },
  };
};

const loader = (respond: (request: Request) => Response | Promise<Response>) => {
  const calls: { id: string; code: unknown }[] = [];
  return {
    calls,
    get: (id: string, code: () => unknown) => {
      calls.push({ id, code: code() });
      return { getEntrypoint: () => ({ fetch: async (request: Request) => respond(request) }) };
    },
  };
};

const published = (patch: Partial<Manifest> = {}): Record<string, string> => {
  const value = manifest(patch);
  return {
    [liveKey(value.slug)]: JSON.stringify({ version: value.version, visibility: value.visibility }),
    [manifestKey(value.slug, value.version)]: JSON.stringify(value),
    [assetKey(OWNER, "etag-index")]: INDEX,
    [assetKey(OWNER, "etag-client")]: CLIENT,
  };
};

interface Harness {
  readonly env: ServeEnv;
  readonly blobs: ReturnType<typeof bucket>;
  readonly isolate: ReturnType<typeof loader>;
}

const harness = (
  objects: Record<string, string>,
  respond: (request: Request) => Response | Promise<Response> = () =>
    new Response(null, { status: 404 }),
): Harness => {
  const blobs = bucket(objects);
  const isolate = loader(respond);
  return {
    blobs,
    isolate,
    env: {
      BLOBS: blobs,
      LOADER: isolate,
      ARTIFACT_SUFFIX: SUFFIX,
      SHELL_ORIGIN: SHELL,
    } as unknown as ServeEnv,
  };
};

/** Bun has no Cache API global; the edge cache is the fast path under test. */
const edge = {
  entries: new Map<string, Response>(),
  matches: [] as string[],
  writes: [] as string[],
  async match(request: Request): Promise<Response | undefined> {
    edge.matches.push(request.url);
    const hit = edge.entries.get(`${request.method} ${request.url}`);
    return hit ? hit.clone() : undefined;
  },
  async put(request: Request, response: Response): Promise<void> {
    edge.writes.push(request.url);
    edge.entries.set(`${request.method} ${request.url}`, response);
  },
};

let previousCaches: unknown;

beforeAll(() => {
  previousCaches = (globalThis as { caches?: unknown }).caches;
  (globalThis as { caches?: unknown }).caches = { default: edge };
});

afterAll(() => {
  (globalThis as { caches?: unknown }).caches = previousCaches;
});

beforeEach(() => {
  edge.entries.clear();
  edge.matches.length = 0;
  edge.writes.length = 0;
});

describe("host matching", () => {
  test("a host that is not an artifact host falls through", async () => {
    const { env } = harness(published());
    expect(await serveArtifact(navigate("https://mezedes.example.com/"), env)).toBeNull();
  });

  test("a slug with no live.json is not found", async () => {
    const { env } = harness({});
    const response = await serveArtifact(navigate(`https://nothing-here.${SUFFIX}/`), env);

    expect(response?.status).toBe(404);
    expect(await response?.text()).toBe("not found");
  });

  test("a private mezes answers exactly as one that does not exist", async () => {
    const { env } = harness(published({ visibility: "private" }));
    const refused = await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/`), env);
    const missing = await serveArtifact(
      navigate(`https://nothing-here.${SUFFIX}/`),
      harness({}).env,
    );

    expect(refused?.status).toBe(missing?.status);
    expect(await refused?.text()).toBe(await missing?.text());
  });
});

describe("static artifacts", () => {
  test("the live host serves index.html and hardens it", async () => {
    const { env } = harness(published());
    const response = await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/`), env);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe(INDEX);
    expect(response?.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response?.headers.get("Referrer-Policy")).toBe("no-referrer");
    /**
     * `frame-ancestors`, not `X-Frame-Options: SAMEORIGIN`. The shell previews a
     * public mezes by framing this very URL, and it is a different origin now,
     * so SAMEORIGIN would refuse the frame the product depends on.
     */
    expect(response?.headers.get("X-Frame-Options")).toBeNull();
    expect(response?.headers.get("Content-Security-Policy")).toBe(
      `frame-ancestors 'self' ${SHELL}`,
    );
  });

  test("the live host is cached briefly, because publishing changes what it means", async () => {
    const { env } = harness(published());
    const response = await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/`), env);

    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  test("a pinned version is immutable and never reads live.json", async () => {
    const { env, blobs } = harness(published());
    const response = await serveArtifact(navigate(`https://${SLUG}-v4.${SUFFIX}/`), env);

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(blobs.reads).not.toContain(liveKey(SLUG));
    expect(blobs.reads).toContain(manifestKey(SLUG, 4));
  });

  test("a subresource is served with its content type", async () => {
    const { env } = harness(published());
    const response = await serveArtifact(subresource(`https://${SLUG}.${SUFFIX}/client.js`), env);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe(CLIENT);
    expect(response?.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
  });

  test("a client route survives a refresh — the navigate falls back to index.html", async () => {
    const { env } = harness(published());
    const response = await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/settings/theme`), env);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe(INDEX);
  });

  test("a missing subresource still gets an honest 404, not the shell", async () => {
    const { env } = harness(published());
    const response = await serveArtifact(subresource(`https://${SLUG}.${SUFFIX}/logo.png`), env);

    expect(response?.status).toBe(404);
    expect(await response?.text()).toBe("not found");
  });

  test("a fetch that misses is a 404 even from the same page as the route that resolves", async () => {
    const { env } = harness(published());
    const api = new Request(`https://${SLUG}.${SUFFIX}/api/data.json`, {
      headers: { Accept: "application/json", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" },
    });

    expect((await serveArtifact(api, env))?.status).toBe(404);
  });
});

describe("the edge cache", () => {
  test("a hit answers with no storage operation at all", async () => {
    const { env, blobs } = harness(published());
    const request = navigate(`https://${SLUG}.${SUFFIX}/`);
    edge.entries.set(`GET ${request.url}`, new Response("cached", { status: 200 }));

    const response = await serveArtifact(request, env);

    expect(await response?.text()).toBe("cached");
    expect(blobs.reads).toEqual([]);
  });

  test("a served 200 is put back", async () => {
    const { env } = harness(published());
    await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/`), env);

    expect(edge.writes).toEqual([`https://${SLUG}.${SUFFIX}/`]);
  });

  test("a 404 is not put back", async () => {
    const { env } = harness(published());
    await serveArtifact(subresource(`https://${SLUG}.${SUFFIX}/logo.png`), env);

    expect(edge.writes).toEqual([]);
  });

  test("a HEAD is not put back", async () => {
    const { env } = harness(published());
    await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/`, { method: "HEAD" }), env);

    expect(edge.writes).toEqual([]);
  });
});

describe("artifacts with a server entry", () => {
  const withServer = () => published({ mainModule: "index.js", modules: { "index.js": "…" } });

  test("an asset wins before any isolate is loaded", async () => {
    const { env, isolate } = harness(withServer());
    const response = await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/`), env);

    expect(await response?.text()).toBe(INDEX);
    expect(isolate.calls).toEqual([]);
  });

  test("a route the authored server owns reaches it, not the single-page fallback", async () => {
    const { env, isolate } = harness(withServer(), () => Response.json({ now: 1 }));
    const response = await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/api/now`), env);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe(JSON.stringify({ now: 1 }));
    expect(isolate.calls).toHaveLength(1);
  });

  test("the isolate is pinned to the version and given nothing", async () => {
    const { env, isolate } = harness(withServer(), () => new Response("ok"));
    await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/api/now`), env);

    expect(isolate.calls[0]?.id).toBe(`${SLUG}@4`);
    expect(isolate.calls[0]?.code).toMatchObject({
      mainModule: "index.js",
      globalOutbound: null,
      env: {},
    });
  });

  test("an isolate response is hardened and never cached — it may vary per request", async () => {
    const { env } = harness(withServer(), () => new Response("ok"));
    const response = await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/api/now`), env);

    expect(response?.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(edge.writes).toEqual([]);
  });

  test("an isolate 404 hands the navigate back to the single-page fallback", async () => {
    const { env } = harness(withServer(), () => new Response(null, { status: 404 }));
    const response = await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/settings`), env);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe(INDEX);
  });

  test("an isolate 404 on a subresource stays a 404", async () => {
    const { env } = harness(withServer(), () => new Response(null, { status: 404 }));
    const response = await serveArtifact(subresource(`https://${SLUG}.${SUFFIX}/logo.png`), env);

    expect(response?.status).toBe(404);
  });

  test("with no server entry nothing loads an isolate at all", async () => {
    const { env, isolate } = harness(published());
    await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/settings`), env);

    expect(isolate.calls).toEqual([]);
  });
});

const TOKEN = "0123456789abcdef0123456789abcdef";

/** A published mezes plus the grant a preview resolves through. */
const granted = (patch: Partial<Manifest> = {}): Record<string, string> => {
  const { slug, version } = manifest(patch);
  return {
    ...published(patch),
    [grantKey(TOKEN)]: JSON.stringify({ slug, version }),
  };
};

describe("preview origins", () => {
  /**
   * The point of the whole arrangement. A private mezes has no public origin,
   * and before this it had no origin at all — only a path under the shell,
   * where the frame's opaque origin made its own module scripts credential-less
   * and Access answered them with 401. The token host serves it.
   */
  test("a PRIVATE mezes serves through its token", async () => {
    const { env } = harness(granted({ visibility: "private" }));
    const response = await serveArtifact(navigate(`https://p--${TOKEN}.${SUFFIX}/`), env);

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe(INDEX);
  });

  test("its module script serves too — the request that used to 401", async () => {
    const { env } = harness(granted({ visibility: "private" }));
    const response = await serveArtifact(
      subresource(`https://p--${TOKEN}.${SUFFIX}/client.js`),
      env,
    );

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe(CLIENT);
  });

  test("the same mezes is still 404 on its public host", async () => {
    const { env } = harness(granted({ visibility: "private" }));
    const response = await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/`), env);

    expect(response?.status).toBe(404);
  });

  test("an unknown token is the same 404 as a made-up hostname", async () => {
    const { env } = harness(granted());
    const unknown = await serveArtifact(navigate(`https://p--${"f".repeat(32)}.${SUFFIX}/`), env);
    const missing = await serveArtifact(navigate(`https://nothing-here.${SUFFIX}/`), env);

    expect(unknown?.status).toBe(missing?.status);
    expect(await unknown?.text()).toBe(await missing?.text());
  });

  test("a preview is never cached — these bytes may be private", async () => {
    const { env } = harness(granted({ visibility: "private" }));
    const response = await serveArtifact(navigate(`https://p--${TOKEN}.${SUFFIX}/`), env);

    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(edge.writes).toEqual([]);
  });

  test("the sandbox directive rides in the same header as frame-ancestors", async () => {
    const { env } = harness(granted());
    const response = await serveArtifact(navigate(`https://p--${TOKEN}.${SUFFIX}/`), env);

    expect(response?.headers.get("Content-Security-Policy")).toBe(
      `sandbox allow-scripts; frame-ancestors 'self' ${SHELL}`,
    );
  });
});

describe("indexing", () => {
  /** Neither a capability URL nor a shared mezes belongs in a search index. */
  test("every artifact response refuses indexing", async () => {
    const { env } = harness(granted());
    const live = await serveArtifact(navigate(`https://${SLUG}.${SUFFIX}/`), env);
    const view = await serveArtifact(navigate(`https://p--${TOKEN}.${SUFFIX}/`), env);

    for (const response of [live, view]) {
      expect(response?.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
    }
  });
});
