import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { undeclaredImports } from "../core/bundle-output.ts";
import type { Diagnostic, DiagnosticKind } from "../core/diagnostics.ts";
import { mergeFiles } from "../core/merge.ts";
import { artifactUrl, assertSlug, located, slugify } from "../core/names.ts";
import { SEED_FILES } from "../core/seed.ts";
import {
  blobSize,
  putAsset,
  putBlob,
  putLive,
  putManifest,
  readBlob,
  type BucketEnv,
  type Visibility,
} from "./blobs.ts";
import { bundle, type Bundled } from "./bundle.ts";
import { diagnose } from "./diagnose.ts";
import type {
  BuildRecord,
  CommitInput,
  MezesDetail,
  MezesSummary,
  VersionRecord,
} from "./owner.ts";

/**
 * Three tools, hand-written schemas, no tool-bridge layer. The handler is
 * `createMcpHandler` from `agents/mcp/server` — a re-export of
 * `createStatelessMcpHandler`, so no Durable Object is involved in the protocol.
 */

const SERVER_NAME = "mezedes";
const SERVER_VERSION = "0.1.0";
const MCP_ROUTE = "/mcp";

const INSTRUCTIONS = `mezedes builds small self-contained web things. Each create is one shot: send the
whole set of files you want, or a subset plus a base version, and it is
installed, typechecked, built and published in that order.

Your code must typecheck and build. A failure at any stage rejects the whole
submission and creates no version, so read the diagnostics and send a corrected
set rather than retrying the same one.

Static files go in public/. The client entry is src/client.tsx and its bundle is
emitted at ./client.js — reference it relatively from index.html, never as
/client.js. A server entry at src/server.ts is optional; without one nothing but
static assets is served, which is the cheaper and more common case.

Declare every npm package you import in package.json dependencies. An undeclared
import is rejected before anything is built.`;

export interface ToolsEnv extends BucketEnv {
  /**
   * The Owner DO namespace. Typed as `unknown` and narrowed below to the RPC
   * surface this module calls: the binding's own type parameter is a
   * deploy-time fact, not a source one.
   */
  readonly OWNER: unknown;
  readonly ARTIFACT_SUFFIX: string;
}

/** What the write path needs of the index. §5.1 declares it. */
interface Index {
  list(query?: string, limit?: number): Promise<MezesSummary[]>;
  get(slug: string): Promise<MezesDetail | null>;
  versionOf(slug: string, n?: number): Promise<VersionRecord | null>;
  allocate(slug: string, name: string): Promise<{ base: VersionRecord | null; next: number }>;
  commit(input: CommitInput): Promise<{ slug: string; version: number }>;
}

/** One index per owner: the DO name IS the tenant key. */
const index = (env: ToolsEnv, owner: string): Index =>
  (env.OWNER as { getByName(name: string): Index }).getByName(owner);

export type McpRequestHandler = (
  request: Request,
  env: unknown,
  ctx: ExecutionContext,
) => Promise<Response>;

/**
 * One handler per hostname, memoized across requests: `env` is an isolate
 * constant, so a handler built on the first request is right for every later
 * one, and rebuilding it per call rebuilds the whole origin policy per call.
 * Bounded by the hostnames the deploy answers on — a Host that matches no route
 * never reaches the Worker, so a forged one cannot grow this map.
 */
const handlers = new Map<string, McpRequestHandler>();

/**
 * Host and Origin are pinned to the hostname the request arrived on. A custom
 * domain gets no default allowlist, and the stateless handler's Origin default
 * is localhost-only, which would reject every real browser-origin call.
 */
export const mcpHandler =
  (env: ToolsEnv, owner: string): McpRequestHandler =>
  (request, workerEnv, ctx) => {
    const hostname = new URL(request.url).hostname;
    // Keyed by owner as well as hostname, because the server closes over the
    // tenant: one handler per (hostname, owner) rather than per hostname. The
    // extra dimension is bounded by the identities the Access policy admits,
    // which is what makes a forged token unable to grow this map.
    const key = `${hostname}\u0000${owner}`;
    let handler = handlers.get(key);
    if (handler === undefined) {
      handler = createMcpHandler(() => createServer(env, owner), {
        route: MCP_ROUTE,
        allowedHostnames: [hostname],
        allowedOriginHostnames: [hostname],
      });
      handlers.set(key, handler);
    }
    return handler(request, workerEnv, ctx);
  };

/** A fresh server per request — concurrent Worker requests must not share one. */
const createServer = (env: ToolsEnv, owner: string): McpServer => {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "search",
    {
      description:
        "List or search mezedes. Returns name, description, URL and version numbers — never file contents.",
      inputSchema: SEARCH_INPUT,
    },
    (args) => guarded(async () => text(await search(env, owner, args))),
  );

  server.registerTool(
    "inspect",
    {
      description:
        "List the files in a mezes, or read specific ones. Omit `paths` to get the file list first.",
      inputSchema: INSPECT_INPUT,
    },
    (args) => guarded(async () => text(await inspect(env, owner, args))),
  );

  server.registerTool(
    "create",
    {
      description:
        "Create a mezes, or a new version of one. Supply only the files that change; the rest carry over from the base version. Your code must typecheck and build — a submission that does neither is rejected whole and no version is created.",
      inputSchema: CREATE_INPUT,
    },
    (args) =>
      guarded(async () => {
        const result = await create(env, owner, args);
        return text(result, !result.ok);
      }),
  );

  return server;
};

// ── search ─────────────────────────────────────────────────────────────────

const SEARCH_INPUT = z.object({
  q: z
    .string()
    .optional()
    .describe("Free-text match over name and description. Omit to list by recency."),
  limit: z.number().int().min(1).max(100).default(20),
});

/** Metadata only: a model must never pay for contents it did not ask for. */
const search = async (
  env: ToolsEnv,
  owner: string,
  args: z.infer<typeof SEARCH_INPUT>,
): Promise<unknown> => {
  const rows = await index(env, owner).list(args.q, args.limit);
  return {
    mezedes: rows.map((row) => located(row, env.ARTIFACT_SUFFIX)),
  };
};

// ── inspect ────────────────────────────────────────────────────────────────

const INSPECT_INPUT = z.object({
  slug: z.string(),
  version: z.number().int().positive().optional().describe("Omit for the live version."),
  paths: z.array(z.string()).optional().describe("Omit to list only. Supply to read contents."),
});

/** Two phases: listing is cheap, and the model chooses what to spend context on. */
const inspect = async (
  env: ToolsEnv,
  owner: string,
  args: z.infer<typeof INSPECT_INPUT>,
): Promise<unknown> => {
  const record = await index(env, owner).versionOf(args.slug, args.version);
  if (record === null) {
    throw new Rejected(
      args.version === undefined
        ? `No mezes named "${args.slug}". Call \`search\` to see what exists.`
        : `Mezes "${args.slug}" has no version ${args.version}.`,
    );
  }

  const files = await Promise.all(
    Object.entries(record.files).map(async ([path, sha]) => ({
      path,
      sha,
      bytes: (await blobSize(env, owner, sha)) ?? 0,
    })),
  );
  files.sort((left, right) => left.path.localeCompare(right.path));

  const listing = { slug: record.slug, version: record.n, files };
  if (args.paths === undefined) return listing;

  const contents: Record<string, string> = {};
  for (const path of args.paths) {
    const sha = record.files[path];
    if (sha === undefined) {
      throw new Rejected(
        `"${path}" is not in ${record.slug} v${record.n}. Call \`inspect\` without \`paths\` for the file list.`,
      );
    }
    const content = await readBlob(env, owner, sha);
    if (content === null) throw new Error(`blob ${sha} for ${path} is missing`);
    contents[path] = content;
  }
  return { ...listing, contents };
};

// ── create ─────────────────────────────────────────────────────────────────

const CREATE_INPUT = z.object({
  slug: z.string().optional().describe("Omit to create a new mezes."),
  base: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Version to build on. Defaults to the live version."),
  name: z.string().optional(),
  description: z.string().max(280).optional(),
  files: z.record(z.string(), z.string()),
  remove: z.array(z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  note: z
    .string()
    .max(140)
    .optional()
    .describe("One line describing this version, shown in the version list."),
});

type CreateResult =
  | { readonly ok: true; readonly slug: string; readonly version: number; readonly url: string }
  | {
      readonly ok: false;
      readonly stage: "install" | "typecheck" | "build";
      readonly diagnostics: readonly Diagnostic[];
    };

/**
 * The submit contract, in the one order it may run: allocate, merge, check the
 * declarations, install and typecheck, build, then write. A failure at any
 * stage rejects the whole submission and writes nothing, so the previous live
 * version keeps serving and a retry costs the model one message rather than a
 * burnt version number.
 */
const create = async (
  env: ToolsEnv,
  owner: string,
  args: z.infer<typeof CREATE_INPUT>,
): Promise<CreateResult> => {
  const db = index(env, owner);
  const removed = args.remove ?? [];

  const slug =
    args.slug === undefined
      ? await freeSlug(db, slugify(args.name ?? "mezes"))
      : assertSlug(args.slug);

  // The mezes's own metadata, which a create may leave alone: an omitted name or
  // description means "unchanged", never "empty". A slug the caller did not
  // supply is free by construction, so only an update pays for the lookup.
  const existing = args.slug === undefined ? null : await db.get(slug);
  const name = args.name ?? existing?.name ?? slug;
  const description = args.description ?? existing?.description ?? "";
  const visibility: Visibility = existing?.visibility ?? "private";

  const { base: live, next } = await db.allocate(slug, name);
  const base = args.base === undefined ? live : await db.versionOf(slug, args.base);
  if (base === null && args.base !== undefined) {
    throw new Rejected(`Mezes "${slug}" has no version ${args.base} to build on.`);
  }

  const carried = await carriedFiles(env, owner, base, args.files, new Set(removed));
  const merged = mergeFiles({ base: carried.contents, supplied: args.files, removed });
  const source = withConfig(merged, args.dependencies);

  // Ahead of the install: an undeclared package is externalised silently and
  // would otherwise ship as a green build, and this names the file the model
  // wrote rather than a path inside the bundler.
  const undeclared = undeclaredImports(source);
  if (undeclared.length > 0) return { ok: false, stage: "install", diagnostics: undeclared };

  // Dependencies are installed inside `diagnose`, so the check is against the
  // real `@types/react` rather than a stub.
  const typeErrors = await diagnose(source);
  if (typeErrors.length > 0) return { ok: false, stage: "typecheck", diagnostics: typeErrors };

  // A package that WAS declared but does not exist on the registry fails here
  // rather than above. The stage is coarse; the diagnostic's kind is what the
  // model acts on.
  const built = await bundle(source);
  if (!built.ok) return { ok: false, stage: "build", diagnostics: built.errors };

  // Bytes land before the index that points at them, and the DO commit is last.
  const files = Object.fromEntries(
    await Promise.all(
      Object.entries(source).map(async ([path, content]) => {
        // A file carried through the merge unchanged is already at its address.
        const known = carried.shas[path];
        const sha =
          known !== undefined && carried.contents[path] === content
            ? known
            : await putBlob(env, owner, content);
        return [path, sha] as const;
      }),
    ),
  );

  await Promise.all(
    [...built.output.assetManifest].map(([path, meta]) => {
      const body = built.output.assets[path];
      return body === undefined ? Promise.resolve() : putAsset(env, owner, meta.etag, body);
    }),
  );

  const build = buildRecord(built.output);
  await putManifest(env, { slug, version: next, visibility, owner, ...build });
  await putLive(env, slug, { version: next, visibility });

  const committed = await db.commit({
    slug,
    version: next,
    name,
    description,
    note: args.note ?? "",
    files,
    build,
  });

  return {
    ok: true,
    slug: committed.slug,
    version: committed.version,
    // The live URL. It resolves on the public origin only while the mezes is
    // public; until then the owner opens it inside the shell.
    url: artifactUrl(slug, env.ARTIFACT_SUFFIX),
  };
};

interface Carried {
  readonly contents: Record<string, string>;
  /** The base sha of each path carried through unchanged: no PUT is owed for it. */
  readonly shas: Record<string, string>;
}

/** Only the paths that survive the merge are read; an overwritten or removed file costs nothing. */
const carriedFiles = async (
  env: ToolsEnv,
  owner: string,
  base: VersionRecord | null,
  supplied: Readonly<Record<string, string>>,
  removed: ReadonlySet<string>,
): Promise<Carried> => {
  const contents: Record<string, string> = {};
  const shas: Record<string, string> = {};
  if (base === null) return { contents, shas };

  await Promise.all(
    Object.entries(base.files)
      .filter(([path]) => supplied[path] === undefined && !removed.has(path))
      .map(async ([path, sha]) => {
        const content = await readBlob(env, owner, sha);
        if (content === null) throw new Error(`base blob ${sha} for ${path} is missing`);
        contents[path] = content;
        shas[path] = sha;
      }),
  );
  return { contents, shas };
};

/**
 * The seed supplies what the toolchain needs and the model did not send: a
 * package.json for the install and a tsconfig for the language service. Its
 * source files are deliberately not injected — a tree with no client entry must
 * stay one, because that is the case that never loads an isolate.
 */
const CONFIG_FILES = ["package.json", "tsconfig.json"] as const;

const withConfig = (
  files: Record<string, string>,
  dependencies: Record<string, string> | undefined,
): Record<string, string> => {
  const source = { ...files };
  for (const path of CONFIG_FILES) {
    const seeded = SEED_FILES[path];
    if (source[path] === undefined && seeded !== undefined) source[path] = seeded;
  }
  if (dependencies !== undefined && Object.keys(dependencies).length > 0) {
    source["package.json"] = withDependencies(source["package.json"] ?? "", dependencies);
  }
  return source;
};

/** Merged into the tree's package.json, because the declaration check and the installer both read only the file. */
const withDependencies = (packageJson: string, dependencies: Record<string, string>): string => {
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(packageJson);
    if (typeof value === "object" && value !== null) parsed = value as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const declared = parsed["dependencies"];
  const merged = {
    ...(typeof declared === "object" && declared !== null ? declared : {}),
    ...dependencies,
  };
  return `${JSON.stringify({ ...parsed, dependencies: merged }, null, 2)}\n`;
};

/**
 * A slug derived from a name that is already taken would silently publish a new
 * version of an unrelated mezes, so the new-mezes path walks to a free one.
 */
const freeSlug = async (db: Index, desired: string): Promise<string> => {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const candidate = attempt === 1 ? desired : slugify(`${desired.slice(0, 32)}-${attempt}`);
    if ((await db.get(candidate)) === null) return candidate;
  }
  return slugify(`${desired.slice(0, 32)}-${Date.now().toString(36)}`);
};

/** `BuildRecord` pins the SPA config exactly; the bundler's `AssetConfig` is wider and every field of it is optional. */
const ASSET_CONFIG = { not_found_handling: "single-page-application" } as const;

const buildRecord = (output: Bundled): BuildRecord => {
  const assets: BuildRecord["assets"] = [...output.assetManifest].map(([path, meta]) => [
    path,
    meta.contentType === undefined
      ? { etag: meta.etag }
      : { contentType: meta.contentType, etag: meta.etag },
  ]);
  return {
    mainModule: output.mainModule,
    modules: modulesOf(output.modules),
    assets,
    assetConfig: ASSET_CONFIG,
  };
};

/** The record stores module text. The bundler types its output as `string | Module`, and only the script forms survive a round trip through JSON. */
const modulesOf = (modules: Bundled["modules"]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [path, value] of Object.entries(modules)) {
    const source = typeof value === "string" ? value : (value.js ?? value.cjs ?? value.text);
    if (source !== undefined) out[path] = source;
  }
  return out;
};

// ── results ────────────────────────────────────────────────────────────────

/** A mistake the caller can correct in one message, as opposed to a service failure. */
class Rejected extends Error {
  override readonly name = "Rejected";
}

const AGENT_ERRORS: Readonly<Record<string, DiagnosticKind>> = {
  Rejected: "semantic",
  InvalidName: "semantic",
};

const text = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

/**
 * A tool failure belongs in the result with `isError`, never as a JSON-RPC
 * error — a protocol error is invisible to the model and it cannot correct
 * itself. The kind is what tells it whether correcting is worth trying.
 */
const guarded = async (run: () => Promise<CallToolResult>): Promise<CallToolResult> => {
  try {
    return await run();
  } catch (cause) {
    const tag = (cause as { name?: unknown } | null)?.name;
    const kind = (typeof tag === "string" ? AGENT_ERRORS[tag] : undefined) ?? "internal";
    return text(
      { error: { kind, message: cause instanceof Error ? cause.message : String(cause) } },
      true,
    );
  }
};
