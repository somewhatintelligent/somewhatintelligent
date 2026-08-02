import { classify, diagnostic, type Diagnostic } from "./diagnostics.ts";

export const SERVER_ENTRY = "src/server.ts";
export const CLIENT_ENTRY = "src/client.tsx";
export const ASSETS_DIR = "public";

/**
 * `createApp` refuses a tree with no server entry, so a client-only mezes gets a
 * synthetic one it never sees and the build reports `mainModule: null` —
 * nothing loads an isolate for it, which is the whole cost story.
 */
export const SYNTHETIC_SERVER =
  "export default { fetch: () => new Response(null, { status: 404 }) };\n";

export const withServerEntry = (
  files: Record<string, string>,
): { source: Record<string, string>; authored: boolean } =>
  files[SERVER_ENTRY] === undefined
    ? { source: { ...files, [SERVER_ENTRY]: SYNTHETIC_SERVER }, authored: false }
    : { source: files, authored: true };

/** Only fires for a package that WAS declared. A typo'd import produces no warning at all. */
export const INSTALL_FAILURE =
  /^(failed to install |registry returned |could not resolve version for |version .* not found for )/i;

const RUNTIME_PREFIX = /^(cloudflare:|node:|bun:|data:|https?:)/;
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Import forms, anchored at the start of a line so a commented-out
 * `// import x from "y"` cannot match. `[^;]*?` spans the newlines of a
 * multi-line named import while stopping at the statement terminator.
 */
const IMPORT_FORMS: readonly RegExp[] = [
  /^[ \t]*import\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^[ \t]*export\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^[ \t]*import\s*["']([^"']+)["']/gm,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
export const packageOf = (specifier: string): string => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
};

/** The npm package a specifier names, or null when it is not one that could be declared. */
const barePackage = (specifier: string | undefined): string | null => {
  if (specifier === undefined) return null;
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  return RUNTIME_PREFIX.test(specifier) ? null : packageOf(specifier);
};

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

const declaredDependencies = (packageJson: string): ReadonlySet<string> => {
  const names = new Set<string>();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(packageJson) as Record<string, unknown>;
  } catch {
    return names;
  }
  for (const field of DEP_FIELDS) {
    const value = parsed[field];
    if (typeof value !== "object" || value === null) continue;
    for (const name of Object.keys(value)) names.add(name);
  }
  return names;
};

/**
 * A bare specifier the bundler cannot resolve is externalised SILENTLY, so a
 * typo'd package would ship as a green build.
 *
 * Reads source, never emitted output: a bundle cannot be scanned for imports
 * because a minified string literal containing `from "` is indistinguishable
 * from one, and React's own code carries several. Checking declarations is also
 * earlier and names the file the model wrote.
 */
export const undeclaredImports = (files: Record<string, string>): Diagnostic[] => {
  const declared = declaredDependencies(files["package.json"] ?? "");

  const found = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    if (!SOURCE_FILE.test(path)) continue;
    for (const pattern of IMPORT_FORMS) {
      for (const [, specifier] of content.matchAll(pattern)) {
        const pkg = barePackage(specifier);
        if (pkg === null || declared.has(pkg) || found.has(pkg)) continue;
        found.set(pkg, path);
      }
    }
  }

  return [...found].map(([pkg, file]) =>
    diagnostic({
      kind: "semantic",
      file,
      message:
        `"${pkg}" is imported by ${file} but is not in package.json dependencies. An undeclared ` +
        "package is silently left as an external import and the bundle fails at load, so this " +
        `would otherwise ship as a green build. Add "${pkg}" to dependencies, or fix the specifier.`,
    }),
  );
};

interface EsbuildMessage {
  text: string;
  pluginName: string;
  location: { file: string; line: number; column: number } | null;
}

const isBuildFailure = (cause: unknown): cause is Error & { errors: EsbuildMessage[] } =>
  cause instanceof Error && Array.isArray((cause as { errors?: unknown }).errors);

/**
 * `createApp` rejects rather than returning errors, and the rejection is either
 * an esbuild `BuildFailure` — structurally detected, there is no class to test
 * against — or a plain Error from the pre-bundle checks.
 */
export const fromThrown = (cause: unknown): Diagnostic[] => {
  if (isBuildFailure(cause)) {
    const messages = cause.errors.map((message) => {
      const kind =
        message.pluginName === "virtual-fs" && message.text.startsWith("File not found: ")
          ? "resolution"
          : classify(message.text);
      return diagnostic({
        kind,
        message: message.text,
        ...(message.location
          ? {
              file: message.location.file,
              line: message.location.line,
              column: message.location.column + 1,
            }
          : {}),
      });
    });
    return messages.length > 0
      ? messages
      : [diagnostic({ kind: "internal", message: cause.message })];
  }

  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.startsWith("@cloudflare/worker-bundler is only supported inside")) {
    return [diagnostic({ kind: "internal", message })];
  }
  return [diagnostic({ message })];
};
