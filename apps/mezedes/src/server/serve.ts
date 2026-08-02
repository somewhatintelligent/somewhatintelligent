import {
  handleAssetRequest,
  type AssetManifest,
  type AssetStorage,
} from "@cloudflare/worker-bundler";
import { parseArtifactHost, parsePreviewHost, type ArtifactRef } from "../core/names.ts";
import {
  readAssetBytes,
  readGrant,
  readLive,
  readManifest as readPublished,
  type BucketEnv,
  type PublishedManifest,
} from "./blobs.ts";

const COMPATIBILITY_DATE = "2026-07-01";

export interface ServeEnv extends BucketEnv {
  readonly LOADER: {
    get(
      id: string,
      code: () => unknown,
    ): { getEntrypoint(): { fetch(r: Request): Promise<Response> } };
  };
  readonly ARTIFACT_SUFFIX: string;
  readonly SHELL_ORIGIN: string;
}

/**
 * A local workerd is started with no Cache API bound. Neither reading
 * `caches.default` nor calling it is safe there — which of the two throws is a
 * runtime detail — so both are guarded and the first failure disables the cache
 * for the rest of the request. No cache means no caching, never no artifact.
 */
interface ArtifactCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

const openCache = (): ArtifactCache => {
  let usable = true;
  return {
    match: async (request) => {
      if (!usable) return undefined;
      try {
        return await caches.default.match(request);
      } catch {
        usable = false;
        return undefined;
      }
    },
    put: async (request, response) => {
      if (!usable) return;
      try {
        await caches.default.put(request, response);
      } catch {
        usable = false;
      }
    },
  };
};

/**
 * Where the manifest's bytes are turned into a response: real assets, then the
 * authored isolate, then the single-page fallback. Both host branches share it
 * so the ordering — and the loader id that makes an isolate reusable across
 * requests — exist once rather than in two copies that must stay identical.
 *
 * `fromIsolate` is what the artifact branch needs to know: an isolate answer is
 * free to vary per request and so is never cached.
 */
interface Delivered {
  readonly response: Response;
  readonly fromIsolate: boolean;
}

const deliver = async (
  request: Request,
  env: ServeEnv,
  manifest: PublishedManifest,
): Promise<Delivered | null> => {
  const assets = assetManifestOf(manifest);
  const storage = assetStorage(env, manifest);

  /**
   * Real assets only. `not_found_handling` is withheld so the single-page
   * fallback cannot answer a route the authored server owns before the isolate
   * has seen it — the ordering is asset, then isolate, then fallback.
   */
  const asset = await handleAssetRequest(request, assets, storage, {
    ...manifest.assetConfig,
    not_found_handling: "none",
  });
  if (asset) return { response: asset, fromIsolate: false };

  if (manifest.mainModule !== null) {
    const worker = env.LOADER.get(`${manifest.slug}@${manifest.version}`, () => ({
      compatibilityDate: COMPATIBILITY_DATE,
      mainModule: manifest.mainModule,
      modules: manifest.modules,
      globalOutbound: null,
      env: {},
    }));
    const served = await worker.getEntrypoint().fetch(request);
    if (served.status !== 404) return { response: served, fromIsolate: true };
  }

  /**
   * Now the fallback, with the manifest's real config. The bundler serves
   * index.html only to a request whose `Accept` carries text/html, so a client
   * router survives a refresh while a missing subresource still 404s.
   */
  const spa = await handleAssetRequest(request, assets, storage, manifest.assetConfig);
  return spa === null ? null : { response: spa, fromIsolate: false };
};

/**
 * The artifact zone's front door: preview hosts and artifact hosts both, since
 * both are decided by parsing `ARTIFACT_SUFFIX` and both run before the auth
 * gate. `null` means "not this zone, fall through".
 */
export const serveArtifact = async (request: Request, env: ServeEnv): Promise<Response | null> => {
  const url = new URL(request.url);

  /**
   * Preview hosts are matched FIRST, and answer at any visibility. The token in
   * the hostname is the authorisation — it is unguessable and it is the only
   * thing that resolves these bytes — so there is no cookie to drop and no gate
   * to 401 a credential-less subresource fetch. That is the whole reason a
   * preview is an origin rather than a path.
   */
  const token = parsePreviewHost(url.hostname, env.ARTIFACT_SUFFIX);
  if (token !== null) return servePreview(request, env, token);

  const ref = parseArtifactHost(url.hostname, env.ARTIFACT_SUFFIX);
  if (ref === null) return null;

  const cache = openCache();
  const hit = await cache.match(request);
  if (hit) return hit;

  const manifest = await readManifest(env, ref);
  // A private mezes is not reachable here at all — same answer as one that does
  // not exist, so the public origin never confirms that a private slug is taken.
  if (manifest === null || manifest.visibility !== "public") return notFound();

  const delivered = await deliver(request, env, manifest);
  if (delivered === null) return notFound();
  return delivered.fromIsolate
    ? harden(delivered.response, env)
    : finish(request, cache, delivered.response, ref, env);
};

/**
 * `AssetMetadata.contentType` is required-but-undefinable, while a manifest
 * read back from R2 may simply not carry the key. The field is materialised on
 * the way in so the manifest stays JSON-shaped and the map stays the bundler's.
 */
const assetManifestOf = (manifest: PublishedManifest): AssetManifest =>
  new Map(
    manifest.assets.map(([path, meta]) => [
      path,
      { contentType: meta.contentType, etag: meta.etag },
    ]),
  );

/** Resolves a live-or-pinned reference through the storage adapter. */
const readManifest = async (env: ServeEnv, ref: ArtifactRef): Promise<PublishedManifest | null> => {
  let version = ref.version;
  if (version === null) {
    const live = await readLive(env, ref.slug);
    if (live === null) return null;
    version = live.version;
  }
  return readPublished(env, ref.slug, version);
};

const assetStorage = (env: ServeEnv, manifest: PublishedManifest): AssetStorage => {
  const etags = new Map(manifest.assets.map(([path, meta]) => [path, meta.etag]));
  return {
    get: async (pathname) => {
      const etag = etags.get(pathname);
      if (etag === undefined) return null;
      return readAssetBytes(env, manifest.owner, etag);
    },
  };
};

/**
 * A pinned version is immutable end to end, so it is cached forever. The live
 * URL is cached only briefly, because publishing a new version changes what it
 * means without changing its key.
 */
const finish = async (
  request: Request,
  cache: ArtifactCache,
  response: Response,
  ref: ArtifactRef,
  env: ServeEnv,
): Promise<Response> => {
  const hardened = harden(response, env);
  const headers = new Headers(hardened.headers);
  headers.set(
    "Cache-Control",
    ref.version === null ? "public, max-age=60" : "public, max-age=31536000, immutable",
  );
  const cacheable = new Response(hardened.body, {
    status: hardened.status,
    statusText: hardened.statusText,
    headers,
  });
  const [toCache, toReturn] = [cacheable.clone(), cacheable];
  if (request.method === "GET" && toCache.status === 200) await cache.put(request, toCache);
  return toReturn;
};

/**
 * Model-generated JavaScript runs on this origin. The artifact subdomain shares
 * nothing with the shell, so the only thing to prevent is it framing or being
 * framed into something that confuses a viewer.
 *
 * `frame-ancestors` rather than `X-Frame-Options: SAMEORIGIN`, because the
 * shell previews a mezes by framing its real URL and the two are not the same
 * origin — SAMEORIGIN refuses that frame before a byte renders. The permitted
 * set is `'self'` plus the shell and nothing else, so this is a narrowing
 * everywhere except the one frame it has to allow.
 *
 * `extra` is how a preview adds `sandbox` WITHOUT restating `frame-ancestors`:
 * a second `Content-Security-Policy` header would replace this one rather than
 * add to it, so the whole policy is composed here, once.
 */
const harden = (response: Response, env: ServeEnv, extra: readonly string[] = []): Response => {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  /**
   * Nothing served here belongs in a search index: a preview URL is a
   * capability, and a published mezes is a thing its author shares, not
   * something to be found. Set on EVERY response rather than left to a
   * `robots.txt` a mezes may not ship — and unlike `robots.txt`, this also
   * covers a crawler that reached the URL from somewhere else.
   */
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.delete("X-Frame-Options");
  headers.set(
    "Content-Security-Policy",
    [...extra, `frame-ancestors 'self' ${env.SHELL_ORIGIN}`].join("; "),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const notFound = (): Response =>
  new Response("not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

/** The frame is the primary defence; this is the one that survives the URL
 *  being opened outside it. `allow-scripts` alone gives the document an opaque
 *  origin, so mezes JavaScript cannot reach /api with the owner's Access cookie. */
const PREVIEW_CSP = "sandbox allow-scripts";

/**
 * A preview, resolved from the token in its hostname. Same manifest, same asset
 * lookup, same asset → isolate → fallback ordering as the public origin, and
 * the same version-pinned loader id so previewing a version reuses whatever
 * isolate serving it already created.
 *
 * NO visibility check, deliberately: the token is the authorisation, and a
 * private mezes is exactly what this path exists to render. The public origin
 * still refuses one, so privacy is unchanged — what changed is that the owner
 * now has a URL for it that a browser will actually load.
 *
 * Nothing here touches `caches.default`. A preview must not sit in a PoP cache:
 * these bytes may be private, and the responses carry `no-store` for the same
 * reason.
 */
const servePreview = async (request: Request, env: ServeEnv, token: string): Promise<Response> => {
  const grant = await readGrant(env, token);
  // An unknown token is not-found, never "wrong token" — the 404 is the same
  // one a made-up hostname gets, so guessing tells an attacker nothing.
  if (grant === null) return sandboxed(notFound(), env);

  const manifest = await readPublished(env, grant.slug, grant.version);
  if (manifest === null) return sandboxed(notFound(), env);

  const delivered = await deliver(request, env, manifest);
  return sandboxed(delivered?.response ?? notFound(), env);
};

/** Every preview response carries the directive — asset, isolate answer or 404
 *  — because the one that does not is the one that gets framed. */
const sandboxed = (response: Response, env: ServeEnv): Response => {
  const hardened = harden(response, env, [PREVIEW_CSP]);
  const headers = new Headers(hardened.headers);
  headers.set("Cache-Control", "no-store");
  /**
   * The opaque origin `allow-scripts` creates is the point, but it also makes
   * every module-script fetch a CORS request that no same-origin check can ever
   * satisfy — so `<script type="module" src="./client.js">`, which the build
   * contract mandates, silently never loads and the preview renders blank.
   * `*` restores the load without restoring the origin: it cannot carry
   * credentials, so the mezes still has no path to /api with the owner's cookie.
   */
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(hardened.body, {
    status: hardened.status,
    statusText: hardened.statusText,
    headers,
  });
};
