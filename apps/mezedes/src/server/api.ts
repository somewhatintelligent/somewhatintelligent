import { isSlug, located, previewOrigin } from "../core/names.ts";
import {
  blobSize,
  grantFor,
  readBlob,
  removeMezes,
  setVisibility,
  type BucketEnv,
  type Visibility,
} from "./blobs.ts";
import type { MezesDetail, MezesSummary, VersionRecord } from "./owner.ts";

/**
 * The shell's JSON API. Everything here is behind Access and reads the index;
 * R2 is touched only through `blobs.ts`, for the bytes a file view needs.
 */

export interface ApiEnv extends BucketEnv {
  /**
   * The Owner DO namespace. Typed as `unknown` and narrowed below to the RPC
   * surface this module calls: the binding's own type parameter is a
   * deploy-time fact, not a source one.
   */
  readonly OWNER: unknown;
  readonly ARTIFACT_SUFFIX: string;
}

/** What the read path needs of the index. §5.1 declares it. */
interface Index {
  list(query?: string, limit?: number): Promise<MezesSummary[]>;
  get(slug: string): Promise<MezesDetail | null>;
  versionOf(slug: string, n?: number): Promise<VersionRecord | null>;
  update(slug: string, patch: { name?: string; visibility?: Visibility }): Promise<MezesDetail>;
  remove(slug: string): Promise<{ removed: boolean }>;
}

/** One index per owner: the DO name IS the tenant key. */
const index = (env: ApiEnv, owner: string): Index =>
  (env.OWNER as { getByName(name: string): Index }).getByName(owner);

export const handleApi = async (
  request: Request,
  env: ApiEnv,
  owner: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const path = url.pathname.split("/").filter((segment) => segment !== "");
  if (path[0] !== "api" || path[1] !== "mezedes") return notFound();

  try {
    return await route(request, env, owner, url, path.slice(2));
  } catch (cause) {
    // The shell is the only caller and Access already covers it, so the detail
    // is what makes a failure diagnosable rather than something to withhold.
    return json({ error: cause instanceof Error ? cause.message : String(cause) }, 500);
  }
};

const route = async (
  request: Request,
  env: ApiEnv,
  owner: string,
  url: URL,
  rest: readonly string[],
): Promise<Response> => {
  if (rest.length === 0) {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const query = url.searchParams.get("q")?.trim();
    const rows = await index(env, owner).list(query === "" ? undefined : query);
    return json({ mezedes: rows.map((row) => located(row, env.ARTIFACT_SUFFIX)) });
  }

  const slug = decodeURIComponent(rest[0] ?? "");
  // Nothing can exist under a name the service would never mint.
  if (!isSlug(slug)) return notFound();

  if (rest.length === 1) return await mezes(request, env, owner, slug);

  if (rest.length === 4 && rest[1] === "v") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const version = Number(rest[2]);
    if (!Number.isSafeInteger(version) || version < 1) return notFound();
    const record = await index(env, owner).versionOf(slug, version);
    if (record === null) return notFound();
    if (rest[3] === "files") return await files(env, owner, record);
    if (rest[3] === "file") return await file(env, owner, record, url.searchParams.get("path"));
    /**
     * The origin the shell frames. Minting is idempotent per version, so this
     * is a GET: calling it twice returns the same capability rather than
     * handing out a second one. Behind Access like everything under `/api`,
     * which is what makes the token owner-only in the first place.
     */
    if (rest[3] === "preview") {
      const token = await grantFor(env, slug, version);
      return json({ url: previewOrigin(token, env.ARTIFACT_SUFFIX) });
    }
  }

  return notFound();
};

const mezes = async (
  request: Request,
  env: ApiEnv,
  owner: string,
  slug: string,
): Promise<Response> => {
  if (request.method === "GET") {
    const detail = await index(env, owner).get(slug);
    return detail === null ? notFound() : json(located(detail, env.ARTIFACT_SUFFIX));
  }

  if (request.method === "PATCH") {
    const patch = await patchBody(request);
    if (patch === null) {
      return badRequest('body must be { name?: string, visibility?: "private" | "public" }');
    }
    /**
     * Visibility travels with the published bytes, and the two writes are
     * ordered so that a half-applied toggle can only ever under-share: the
     * bytes go private before the index does, and public only after it has.
     */
    if (patch.visibility === "private") await setVisibility(env, slug, "private");
    const detail = await index(env, owner).update(slug, patch);
    if (patch.visibility === "public") await setVisibility(env, slug, "public");
    return json(located(detail, env.ARTIFACT_SUFFIX));
  }

  if (request.method === "DELETE") {
    /**
     * The bytes stop serving before the index forgets them; the reverse leaves
     * a public URL alive with nothing pointing at it. Blobs and assets are
     * content-addressed and shared, so only `pub/<slug>/` goes.
     */
    await removeMezes(env, slug);
    return json(await index(env, owner).remove(slug));
  }

  return methodNotAllowed("GET, PATCH, DELETE");
};

const files = async (env: ApiEnv, owner: string, record: VersionRecord): Promise<Response> => {
  const listing = await Promise.all(
    Object.entries(record.files).map(async ([path, sha]) => ({
      path,
      sha,
      bytes: (await blobSize(env, owner, sha)) ?? 0,
    })),
  );
  listing.sort((left, right) => left.path.localeCompare(right.path));
  return json({ files: listing });
};

const file = async (
  env: ApiEnv,
  owner: string,
  record: VersionRecord,
  path: string | null,
): Promise<Response> => {
  if (path === null) return badRequest("?path= is required");
  const sha = record.files[path];
  if (sha === undefined) return notFound();
  const content = await readBlob(env, owner, sha);
  if (content === null) return notFound();
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // A version is immutable, so its bytes at a path are too. `nosniff`
      // because this is model-written source being handed to a browser.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

interface Patch {
  readonly name?: string;
  readonly visibility?: Visibility;
}

/** null means the body is not a patch this route will apply. */
const patchBody = async (request: Request): Promise<Patch | null> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;

  const { name, visibility } = body as { name?: unknown; visibility?: unknown };
  if (name !== undefined && (typeof name !== "string" || name.trim() === "")) return null;
  if (visibility !== undefined && visibility !== "private" && visibility !== "public") return null;
  if (name === undefined && visibility === undefined) return null;

  return {
    ...(name === undefined ? {} : { name: name.trim() }),
    ...(visibility === undefined ? {} : { visibility }),
  };
};

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const notFound = (): Response => json({ error: "not found" }, 404);

const badRequest = (message: string): Response => json({ error: message }, 400);

const methodNotAllowed = (allow: string): Response =>
  new Response(JSON.stringify({ error: `method not allowed; allowed: ${allow}` }), {
    status: 405,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Allow: allow,
    },
  });
