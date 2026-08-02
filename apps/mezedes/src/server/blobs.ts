/**
 * The only module that names `R2Bucket`. Everything above it moves bytes by
 * content address: a blob is its own sha-256 and an asset is its own etag, so
 * no key can ever be overwritten with different bytes and an earlier version
 * stays byte-identical forever.
 */

import {
  assetKey,
  blobKey,
  grantKey,
  isVersionGrantKey,
  liveKey,
  manifestKey,
  mezesPrefix,
  versionGrantKey,
} from "../core/keys.ts";
import { newPreviewToken } from "../core/names.ts";

export type Visibility = "private" | "public";

/**
 * The read path's slice. `serve.ts` takes this rather than the bucket, so R2 is
 * named in exactly one module and the boundary in section 2 is true rather than
 * aspirational.
 */
export interface BucketEnv {
  readonly BLOBS: R2Bucket;
}

/**
 * What the artifact origin reads. The `BuildRecord` plus `owner`, because
 * serving is unauthenticated and has no token to derive an identity from, so
 * the identity has to travel with the published manifest.
 */
export interface PublishedManifest {
  readonly slug: string;
  readonly version: number;
  readonly visibility: Visibility;
  readonly owner: string;
  readonly mainModule: string | null;
  readonly modules: Record<string, string>;
  readonly assets: readonly [path: string, meta: { contentType?: string; etag: string }][];
  readonly assetConfig: { not_found_handling: "single-page-application" };
}

/** `grant/<token>.json` — what a preview hostname resolves to. */
export interface PreviewGrant {
  readonly slug: string;
  readonly version: number;
}

/** `pub/<slug>/live.json` — which version a bare mezes URL serves. */
export interface LivePointer {
  readonly version: number;
  readonly visibility: Visibility;
}

const JSON_METADATA = { httpMetadata: { contentType: "application/json" } };

/** R2's per-call ceiling on a batched delete. */
const DELETE_BATCH = 1000;

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (content: string): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content))));

/**
 * Every JSON object under `pub/` and `grant/` goes through this pair, so the
 * contract is stated once: an object that is missing and an object that will
 * not parse are the same answer, because a caller can do nothing different
 * about either, and `JSON_METADATA` cannot be forgotten at a call site.
 */
const readJson = async <T>(env: BucketEnv, key: string): Promise<T | null> => {
  const object = await env.BLOBS.get(key);
  if (object === null) return null;
  try {
    return (await object.json()) as T;
  } catch {
    return null;
  }
};

const putJson = async (env: BucketEnv, key: string, value: unknown): Promise<void> => {
  await env.BLOBS.put(key, JSON.stringify(value), JSON_METADATA);
};

/** R2 caps a batched delete, so anything longer goes in chunks. */
const deleteAll = async (env: BucketEnv, keys: readonly string[]): Promise<void> => {
  for (let at = 0; at < keys.length; at += DELETE_BATCH) {
    await env.BLOBS.delete(keys.slice(at, at + DELETE_BATCH));
  }
};

// Everything below that is owner-scoped takes `owner` as an argument rather
// than reading it off `env`, the way `readAssetBytes` already did: the tenant
// is a property of the REQUEST — it comes from the verified token — and never
// of the deploy. Keys under `pub/` take none, because serving is
// unauthenticated and the manifest carries the owner instead.

/** Returns the address the bytes landed at, which is the only name they have. */
export const putBlob = async (env: BucketEnv, owner: string, content: string): Promise<string> => {
  const sha = await sha256(content);
  await env.BLOBS.put(blobKey(owner, sha), content);
  return sha;
};

export const readBlob = async (
  env: BucketEnv,
  owner: string,
  sha: string,
): Promise<string | null> => {
  const object = await env.BLOBS.get(blobKey(owner, sha));
  return object === null ? null : await object.text();
};

/** Size without the body: a file listing needs bytes, not contents. */
export const blobSize = async (
  env: BucketEnv,
  owner: string,
  sha: string,
): Promise<number | null> => {
  const object = await env.BLOBS.head(blobKey(owner, sha));
  return object === null ? null : object.size;
};

export const putAsset = async (
  env: BucketEnv,
  owner: string,
  etag: string,
  body: string | ArrayBuffer,
): Promise<void> => {
  await env.BLOBS.put(assetKey(owner, etag), body);
};

/** The asset bytes for a published etag, as a stream the origin can pass through. */
export const readAssetBytes = async (
  env: BucketEnv,
  owner: string,
  etag: string,
): Promise<ReadableStream | null> => {
  const object = await env.BLOBS.get(assetKey(owner, etag));
  return object === null ? null : object.body;
};

/**
 * Written last, after every blob and asset it references. A crash mid-create
 * leaves orphaned bytes that nothing points at, never a manifest that points at
 * bytes which are not there.
 */
export const putManifest = (env: BucketEnv, manifest: PublishedManifest): Promise<void> =>
  putJson(env, manifestKey(manifest.slug, manifest.version), manifest);

export const readManifest = (
  env: BucketEnv,
  slug: string,
  version: number,
): Promise<PublishedManifest | null> =>
  readJson<PublishedManifest>(env, manifestKey(slug, version));

/**
 * The token for a version, minting one if it has none. Idempotent by way of the
 * `pub/` side: a second call reads the token the first wrote rather than
 * granting a second capability to the same bytes.
 *
 * Unguessable is the whole security property — 128 bits from `getRandomValues`,
 * hex so it is a legal DNS label. There is no expiry, because the URL IS the
 * grant and an expiring preview would break the frame mid-session; revocation
 * is deleting the mezes, which clears both objects.
 */
export const grantFor = async (env: BucketEnv, slug: string, version: number): Promise<string> => {
  const held = await readJson<{ token?: string }>(env, versionGrantKey(slug, version));
  if (typeof held?.token === "string") return held.token;

  const token = newPreviewToken();
  // The reverse object FIRST, and NOT concurrently: if only the `pub/` side
  // landed, the idempotent read above would keep returning a token that
  // resolves to nothing, and that version could never be previewed again.
  await putJson(env, grantKey(token), { slug, version });
  await putJson(env, versionGrantKey(slug, version), { token });
  return token;
};

export const readGrant = (env: BucketEnv, token: string): Promise<PreviewGrant | null> =>
  readJson<PreviewGrant>(env, grantKey(token));

export const putLive = (env: BucketEnv, slug: string, live: LivePointer): Promise<void> =>
  putJson(env, liveKey(slug), live);

export const readLive = (env: BucketEnv, slug: string): Promise<LivePointer | null> =>
  readJson<LivePointer>(env, liveKey(slug));

/**
 * The artifact origin reads visibility from the manifest, not the index, and a
 * pinned version URL reads its own. A toggle therefore rewrites every published
 * manifest under the mezes as well as the live pointer.
 */
export const setVisibility = async (
  env: BucketEnv,
  slug: string,
  visibility: Visibility,
): Promise<void> => {
  for (const key of await listPrefix(env, mezesPrefix(slug))) {
    if (!key.endsWith("/manifest.json")) continue;
    const object = await env.BLOBS.get(key);
    if (object === null) continue;
    let manifest: PublishedManifest;
    try {
      manifest = (await object.json()) as PublishedManifest;
    } catch {
      continue;
    }
    await env.BLOBS.put(key, JSON.stringify({ ...manifest, visibility }), JSON_METADATA);
  }

  const live = await readLive(env, slug);
  if (live !== null) await putLive(env, slug, { version: live.version, visibility });
};

/**
 * Every object under a mezes's published prefix. Blobs and assets are
 * content-addressed and shared between versions and between mezedes, so they are
 * left where they are.
 */
export const removeMezes = async (env: BucketEnv, slug: string): Promise<void> => {
  const keys = await listPrefix(env, mezesPrefix(slug));

  /**
   * Grants live outside `pub/<slug>/`, so the prefix delete alone would leave
   * every preview URL for this mezes still resolving. They are read by name
   * first — concurrently, because a mezes previewed at twenty versions would
   * otherwise pay twenty serial round trips — and deleted alongside the rest.
   */
  const held = await Promise.all(
    keys.filter(isVersionGrantKey).map((key) => readJson<{ token?: string }>(env, key)),
  );
  const grants = held.flatMap((grant) =>
    typeof grant?.token === "string" ? [grantKey(grant.token)] : [],
  );

  await deleteAll(env, [...grants, ...keys]);
};

const listPrefix = async (env: BucketEnv, prefix: string): Promise<string[]> => {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BLOBS.list({ prefix, ...(cursor === undefined ? {} : { cursor }) });
    for (const object of page.objects) keys.push(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return keys;
};
