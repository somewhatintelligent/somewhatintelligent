/**
 * Native code-graph extraction — what `fallow viz` computes, done directly
 * with the same underlying engine (oxc), no subprocess.
 *
 *   bun prototypes/c4-topology/oxgraph.ts
 *
 * Pipeline: discover source files (apps/, packages/, infra/) → parse each
 * with oxc-parser (napi binding over the same oxc_parser crate fallow uses;
 * .astro files contribute their frontmatter fence) → resolve import
 * specifiers with oxc-resolver against each file's nearest tsconfig →
 * assemble the graph: import edges with type-only flags, per-function
 * cyclomatic/cognitive complexity from the AST, unused-export analysis,
 * Tarjan cycles, and cross-app boundary violations.
 *
 * Emits codegraph.json in the same schema `codegraph.ts` lifts out of
 * fallow's viz payload, so `generate.ts` consumes either interchangeably.
 * Cognitive complexity is a nesting-weighted approximation of fallow's
 * (sonar-style) metric — close, not identical.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSync } from "oxc-parser";
import { ResolverFactory } from "oxc-resolver";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const OUT = path.join(repoRoot, "prototypes/c4-topology/codegraph.json");

// ── .fallowrc.jsonc: honor the repo's own entry/ignore/boundary model ──────

/** Strip //-comments and /*-comments outside strings (enough for JSONC). */
const stripJsonc = (text: string): string => {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1"); // trailing commas
};

interface FallowConfig {
  entry?: string[];
  ignorePatterns?: string[];
  boundaries?: {
    zones?: { name: string; patterns: string[] }[];
    rules?: { from: string; allow: string[]; allowTypeOnly?: string[] }[];
  };
}

const fallowrcPath = path.join(repoRoot, ".fallowrc.jsonc");
const fallowrc: FallowConfig = fs.existsSync(fallowrcPath)
  ? JSON.parse(stripJsonc(fs.readFileSync(fallowrcPath, "utf8")))
  : {};

/**
 * Minimal glob → regex: `**` crosses slashes, `*` does not. Globstars go
 * through placeholders so the `.*` they emit isn't re-mangled by the
 * single-star pass.
 */
const globToRegex = (glob: string): RegExp => {
  const GLOBSTAR_SLASH = "\u0001";
  const GLOBSTAR = "\u0002";
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, GLOBSTAR_SLASH)
    .replace(/\*\*/g, GLOBSTAR)
    .replace(/\*/g, "[^/]*")
    .replaceAll(GLOBSTAR_SLASH, "(?:.*/)?")
    .replaceAll(GLOBSTAR, ".*");
  return new RegExp(`^${escaped}$`);
};
const entryGlobs = (fallowrc.entry ?? []).map(globToRegex);
const ignoreGlobs = (fallowrc.ignorePatterns ?? []).map(globToRegex);
const zoneDefs = (fallowrc.boundaries?.zones ?? []).map((z) => ({
  name: z.name,
  patterns: z.patterns.map(globToRegex),
}));
const zoneRules = new Map(
  (fallowrc.boundaries?.rules ?? []).map((r) => [
    r.from,
    { allow: new Set(r.allow), allowTypeOnly: new Set(r.allowTypeOnly ?? []) },
  ]),
);

// ── discovery ──────────────────────────────────────────────────────────────

const ROOTS = ["apps", "packages", "infra"];
const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".astro"]);
const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".alchemy",
  ".astro",
  ".wrangler",
  "migrations",
  "worktrees",
]);

const discover = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full);
      } else if (EXTENSIONS.has(path.extname(entry.name))) {
        const rel = path.relative(repoRoot, full);
        if (!ignoreGlobs.some((g) => g.test(rel))) found.push(rel);
      }
    }
  };
  for (const root of ROOTS) walk(path.join(repoRoot, root));
  return found.sort();
};

// ── parsing ────────────────────────────────────────────────────────────────

interface FnMetric {
  name: string;
  line: number;
  cyclomatic: number;
  cognitive: number;
  lines: number;
}

interface ParsedFile {
  path: string;
  size: number;
  imports: { specifier: string; typeOnly: boolean; line: number }[];
  exports: { name: string; typeOnly: boolean }[];
  reExports: { specifier: string; star: boolean; typeOnly: boolean; line: number }[];
  functions: FnMetric[];
  fnCount: number;
}

/**
 * .astro: the frontmatter fence is a TS module, and template `<script>`
 * blocks (unless `is:inline`) are additional client modules whose imports
 * count — fallow parses both, so we do too.
 */
const extractSources = (relPath: string, raw: string): { source: string; lineOffset: number }[] => {
  if (!relPath.endsWith(".astro")) return [{ source: raw, lineOffset: 0 }];
  const parts: { source: string; lineOffset: number }[] = [];
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) parts.push({ source: fm[1]!, lineOffset: 1 });
  const lineAt = (offset: number) => raw.slice(0, offset).split("\n").length - 1;
  for (const m of raw.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (m[1]!.includes("is:inline") || m[1]!.includes("src=")) continue;
    parts.push({ source: m[2]!, lineOffset: lineAt(m.index!) });
  }
  return parts.length ? parts : [{ source: "", lineOffset: 0 }];
};

const lineOf = (starts: number[], offset: number): number => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

const DECISIONS = new Set([
  "IfStatement",
  "ConditionalExpression",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
]);
const NESTING = new Set([...DECISIONS, "SwitchStatement"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/**
 * Walk one function body (excluding nested functions, which are measured
 * separately): cyclomatic = 1 + decision points; cognitive ≈ decision points
 * weighted by nesting depth + logical operators.
 */
const measureFn = (fnNode: any): { cyclomatic: number; cognitive: number } => {
  let cyclomatic = 1;
  let cognitive = 0;
  const visit = (node: any, depth: number) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth);
      return;
    }
    if (node !== fnNode && FUNCTIONS.has(node.type)) return; // nested fn measured on its own
    let nextDepth = depth;
    if (DECISIONS.has(node.type)) {
      cyclomatic += 1;
      cognitive += 1 + depth;
    } else if (node.type === "SwitchCase" && node.test) {
      cyclomatic += 1;
      cognitive += 1;
    } else if (node.type === "LogicalExpression") {
      cyclomatic += 1;
      cognitive += 1;
    }
    if (NESTING.has(node.type)) nextDepth = depth + 1;
    for (const key in node) {
      if (key === "type" || key === "start" || key === "end") continue;
      visit(node[key], nextDepth);
    }
  };
  visit(fnNode.body ?? fnNode, 0);
  return { cyclomatic, cognitive };
};

const collectFunctions = (
  program: any,
  starts: number[],
  lineOffset: number,
): { functions: FnMetric[]; fnCount: number } => {
  const functions: FnMetric[] = [];
  let fnCount = 0;
  const nameFor = (node: any, parent: any): string | undefined => {
    if (node.id?.name) return node.id.name;
    if (!parent) return undefined;
    if (parent.type === "VariableDeclarator" && parent.id?.name) return parent.id.name;
    if (
      (parent.type === "MethodDefinition" ||
        parent.type === "PropertyDefinition" ||
        parent.type === "Property") &&
      parent.key
    )
      return parent.key.name ?? parent.key.value;
    return undefined;
  };
  const visit = (node: any, parent: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent);
      return;
    }
    if (node.type && FUNCTIONS.has(node.type)) {
      fnCount += 1;
      const name = nameFor(node, parent);
      if (name) {
        const { cyclomatic, cognitive } = measureFn(node);
        const startLine = lineOf(starts, node.start) + lineOffset;
        const endLine = lineOf(starts, node.end) + lineOffset;
        functions.push({
          name,
          line: startLine,
          cyclomatic,
          cognitive,
          lines: endLine - startLine + 1,
        });
      }
    }
    for (const key in node) {
      if (key === "type" || key === "start" || key === "end") continue;
      visit(node[key], node.type ? node : parent);
    }
  };
  visit(program, undefined);
  functions.sort((a, b) => b.cyclomatic - a.cyclomatic || b.cognitive - a.cognitive);
  return { functions, fnCount };
};

const parseFile = (relPath: string): ParsedFile | undefined => {
  const raw = fs.readFileSync(path.join(repoRoot, relPath), "utf8");
  const parseAs = relPath.endsWith(".astro")
    ? relPath.replace(/\.astro$/, ".frontmatter.ts")
    : relPath;
  const imports: ParsedFile["imports"] = [];
  const reExports: ParsedFile["reExports"] = [];
  const exports: ParsedFile["exports"] = [];
  const functions: FnMetric[] = [];
  let fnCount = 0;

  for (const { source, lineOffset } of extractSources(relPath, raw)) {
    let result;
    try {
      result = parseSync(parseAs, source);
    } catch {
      continue;
    }
    const starts = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);

    for (const imp of result.module.staticImports) {
      imports.push({
        specifier: imp.moduleRequest.value,
        typeOnly: imp.entries.length > 0 && imp.entries.every((e: any) => e.isType),
        line: lineOf(starts, imp.start) + lineOffset,
      });
    }
    for (const dyn of result.module.dynamicImports) {
      const spec = source.slice(dyn.moduleRequest.start + 1, dyn.moduleRequest.end - 1);
      if (spec && !spec.includes("${"))
        imports.push({
          specifier: spec,
          typeOnly: false,
          line: lineOf(starts, dyn.start) + lineOffset,
        });
    }
    for (const exp of result.module.staticExports) {
      for (const entry of exp.entries as any[]) {
        if (entry.moduleRequest) {
          reExports.push({
            specifier: entry.moduleRequest.value,
            star: entry.importName.kind === "AllButDefault" || entry.importName.kind === "All",
            typeOnly: entry.isType,
            line: lineOf(starts, exp.start) + lineOffset,
          });
          if (entry.exportName?.name)
            exports.push({ name: entry.exportName.name, typeOnly: entry.isType });
          continue;
        }
        const name = entry.exportName.kind === "Default" ? "default" : entry.exportName.name;
        if (name) exports.push({ name, typeOnly: entry.isType });
      }
    }
    const collected = collectFunctions(result.program, starts, lineOffset);
    functions.push(...collected.functions);
    fnCount += collected.fnCount;
  }
  functions.sort((a, b) => b.cyclomatic - a.cyclomatic || b.cognitive - a.cognitive);
  return {
    path: relPath,
    size: Buffer.byteLength(raw),
    imports,
    exports,
    reExports,
    functions,
    fnCount,
  };
};

// ── resolution ─────────────────────────────────────────────────────────────

const tsconfigFor = (() => {
  const cache = new Map<string, string | undefined>();
  return (dir: string): string | undefined => {
    if (cache.has(dir)) return cache.get(dir);
    const candidate = path.join(dir, "tsconfig.json");
    const result = fs.existsSync(candidate)
      ? candidate
      : dir === repoRoot || dir === "/"
        ? undefined
        : tsconfigFor(path.dirname(dir));
    cache.set(dir, result);
    return result;
  };
})();

const resolvers = new Map<string, ResolverFactory>();
const resolverFor = (tsconfig: string | undefined): ResolverFactory => {
  const key = tsconfig ?? "(none)";
  if (!resolvers.has(key)) {
    resolvers.set(
      key,
      new ResolverFactory({
        extensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json", ".astro"],
        conditionNames: ["import", "browser", "module", "node", "default"],
        mainFields: ["module", "main"],
        extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] },
        ...(tsconfig ? { tsconfig: { configFile: tsconfig, references: "auto" } } : {}),
      }),
    );
  }
  return resolvers.get(key)!;
};

// ── main ───────────────────────────────────────────────────────────────────

const files = discover();
const parsed = new Map<string, ParsedFile>();
for (const file of files) {
  const p = parseFile(file);
  if (p) parsed.set(file, p);
}

const index = new Map([...parsed.keys()].map((p, i) => [p, i]));
const paths = [...parsed.keys()];

const resolveSpecifier = (fromRel: string, specifier: string): string | undefined => {
  if (
    specifier.startsWith("node:") ||
    specifier.startsWith("bun:") ||
    specifier.startsWith("cloudflare:")
  )
    return undefined;
  const fromDir = path.join(repoRoot, path.dirname(fromRel));
  const resolver = resolverFor(tsconfigFor(fromDir));
  const result = resolver.sync(fromDir, specifier);
  if (!result.path) return undefined;
  let real = result.path;
  try {
    real = fs.realpathSync(real); // bun workspace deps are symlinks into packages/*
  } catch {
    /* keep */
  }
  if (!real.startsWith(repoRoot + path.sep)) return undefined;
  const rel = path.relative(repoRoot, real);
  return index.has(rel) ? rel : undefined;
};

// edges keyed importer→imported; value: {typeOnly: all statements type-only, line: first}
const edgeMap = new Map<
  string,
  { from: number; to: number; typeOnly: boolean; line: number; specifier: string }
>();
// which (file, exportName) pairs are consumed, for unused-export analysis
const consumed = new Set<string>();
const namespaceConsumed = new Set<string>(); // whole file consumed via ns/star/default-heavy patterns

for (const file of parsed.values()) {
  const fromIdx = index.get(file.path)!;
  const record = (targetRel: string, typeOnly: boolean, line: number, specifier: string) => {
    const toIdx = index.get(targetRel)!;
    if (toIdx === fromIdx) return;
    const key = `${fromIdx}→${toIdx}`;
    const existing = edgeMap.get(key);
    if (existing) existing.typeOnly = existing.typeOnly && typeOnly;
    else edgeMap.set(key, { from: fromIdx, to: toIdx, typeOnly, line, specifier });
  };
  for (const imp of file.imports) {
    const target = resolveSpecifier(file.path, imp.specifier);
    if (!target) continue;
    record(target, imp.typeOnly, imp.line, imp.specifier);
  }
  for (const re of file.reExports) {
    const target = resolveSpecifier(file.path, re.specifier);
    if (!target) continue;
    record(target, re.typeOnly, re.line, re.specifier);
    namespaceConsumed.add(target); // conservatively: re-export keeps target's exports alive
  }
}

// Export-consumption pass: which (file, exportName) pairs does anyone import?
// Re-reads module records per file; parse is fast enough that retaining the
// entries in ParsedFile isn't worth the memory.
for (const file of parsed.values()) {
  const full = path.join(repoRoot, file.path);
  const raw = fs.readFileSync(full, "utf8");
  const parseAs = file.path.endsWith(".astro")
    ? file.path.replace(/\.astro$/, ".frontmatter.ts")
    : file.path;
  for (const { source } of extractSources(file.path, raw)) {
    let mod;
    try {
      mod = parseSync(parseAs, source).module;
    } catch {
      continue;
    }
    for (const imp of mod.staticImports) {
      const target = resolveSpecifier(file.path, imp.moduleRequest.value);
      if (!target) continue;
      if (imp.entries.length === 0) {
        namespaceConsumed.add(target); // side-effect import
        continue;
      }
      for (const entry of imp.entries as any[]) {
        if (entry.importName.kind === "Name") consumed.add(`${target}#${entry.importName.name}`);
        else if (entry.importName.kind === "Default") consumed.add(`${target}#default`);
        else namespaceConsumed.add(target); // namespace import: everything reachable
      }
    }
    for (const exp of mod.staticExports) {
      for (const entry of exp.entries as any[]) {
        if (!entry.moduleRequest) continue;
        const target = resolveSpecifier(file.path, entry.moduleRequest.value);
        if (!target) continue;
        if (entry.importName?.kind === "Name") consumed.add(`${target}#${entry.importName.name}`);
        else namespaceConsumed.add(target); // star re-export
      }
    }
    for (const dyn of mod.dynamicImports) {
      const spec = source.slice(dyn.moduleRequest.start + 1, dyn.moduleRequest.end - 1);
      const target = spec && !spec.includes("${") ? resolveSpecifier(file.path, spec) : undefined;
      if (target) namespaceConsumed.add(target);
    }
  }
}

// entry points: alchemy anchors + conventional roots + tests
const topology = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "prototypes/c4-topology/topology.json"), "utf8"),
);
const anchors = new Set<string>();
for (const n of topology.nodes) {
  const main = n.props?.main;
  const rootDir = n.props?.rootDir;
  const rel = (p: string) => p.replace(/^file:\/\//, "").replace(repoRoot + "/", "");
  if (typeof main === "string") anchors.add(rel(main));
  if (typeof rootDir === "string") anchors.add(rel(rootDir));
}
const isEntry = (p: string) =>
  entryGlobs.some((g) => g.test(p)) ||
  anchors.has(p) ||
  [...anchors].some(
    (a) =>
      !a.includes(".") &&
      p.startsWith(a + "/") &&
      /(^|\/)(pages|routes|app)\//.test(p.slice(a.length)),
  ) ||
  p.endsWith("alchemy.run.ts") ||
  /(\.test\.|\.spec\.|\/test\/|\/integ\/)/.test(p) ||
  /(^|\/)[\w.-]+\.config\.[mc]?[jt]s$/.test(p) || // vite/astro/… load these by convention
  /(^|\/)(entry\.(server|client)|root)\.[jt]sx?$/.test(p) || // framework-loaded entries
  p.endsWith(".d.ts");

// cycles: Tarjan SCC over runtime (non-type-only) edges
const adj = new Map<number, number[]>();
for (const e of edgeMap.values()) {
  if (e.typeOnly) continue;
  if (!adj.has(e.from)) adj.set(e.from, []);
  adj.get(e.from)!.push(e.to);
}
const cycles: number[][] = [];
{
  let counter = 0;
  const idx = new Map<number, number>();
  const low = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const strongconnect = (v: number) => {
    idx.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const scc: number[] = [];
      while (true) {
        const w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      if (scc.length > 1) cycles.push(scc.reverse());
    }
  };
  for (let v = 0; v < paths.length; v++) if (!idx.has(v)) strongconnect(v);
}
const inCycle = new Set(cycles.flat());

// Zones + violations straight from .fallowrc.jsonc: first-matching zone wins
// (zone order is semantic in the config); a rule is an allow-list — an edge
// into a zone the from-zone's rule doesn't allow is a violation. Falls back
// to top-level-directory zones when the repo has no boundary config.
const zoneOf = (p: string): string => {
  for (const z of zoneDefs) if (z.patterns.some((g) => g.test(p))) return z.name;
  if (p.startsWith("apps/") || p.startsWith("packages/")) return p.split("/").slice(0, 2).join("/");
  return "infra";
};
const zoneNames = [...new Set(paths.map(zoneOf))].sort();
const zoneIdx = new Map(zoneNames.map((z, i) => [z, i]));
const violations = [...edgeMap.values()]
  .filter((e) => {
    const a = zoneOf(paths[e.from]!);
    const b = zoneOf(paths[e.to]!);
    if (a === b) return false;
    const rule = zoneRules.get(a);
    if (!rule) return false; // no rule for the zone = unrestricted
    if (rule.allow.has(b)) return false;
    if (e.typeOnly && rule.allowTypeOnly.has(b)) return false;
    return true;
  })
  .map((e) => ({
    from: e.from,
    to: e.to,
    from_zone: zoneIdx.get(zoneOf(paths[e.from]!))!,
    to_zone: zoneIdx.get(zoneOf(paths[e.to]!))!,
    line: e.line,
    specifier: e.specifier,
  }));

// ── enrichment: fallow's checker-grade dead-code analysis ──────────────────
//
// The import graph above is ours and exact. Unused exports are NOT a graph
// question — proving an export unused means resolving re-export chains through
// barrels and seeing type-position uses, which needs a type checker. fallow
// has one; we don't. So we ask it, and fall back to our syntactic candidates
// (labelled as such in the UI) when it isn't available.

interface DeadCode {
  unusedExports: Map<string, string[]>;
  unusedFiles: Set<string>;
  authoritative: boolean;
}

const askFallow = (): DeadCode => {
  const empty: DeadCode = {
    unusedExports: new Map(),
    unusedFiles: new Set(),
    authoritative: false,
  };
  let raw: string | undefined;
  try {
    raw = execFileSync("bunx", ["fallow", "dead-code", "--format", "json", "-q"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    // fallow exits non-zero when it finds issues — a successful run with
    // findings on stdout, not a failure.
    raw = (error as { stdout?: string }).stdout;
  }
  if (!raw) {
    console.warn("! fallow dead-code unavailable — using syntactic unused-export candidates");
    return empty;
  }
  let report: {
    unused_exports?: { path: string; export_name: string }[];
    unused_files?: { path: string }[];
  };
  try {
    report = JSON.parse(raw);
  } catch {
    console.warn("! fallow dead-code output unparseable — using syntactic candidates");
    return empty;
  }
  const unusedExports = new Map<string, string[]>();
  for (const finding of report.unused_exports ?? []) {
    if (!unusedExports.has(finding.path)) unusedExports.set(finding.path, []);
    unusedExports.get(finding.path)!.push(finding.export_name);
  }
  return {
    unusedExports,
    unusedFiles: new Set((report.unused_files ?? []).map((f) => f.path)),
    authoritative: true,
  };
};

const deadCode = askFallow();

// per-file rollup
const importerCount = new Map<number, number>();
const importCount = new Map<number, number>();
for (const e of edgeMap.values()) {
  importCount.set(e.from, (importCount.get(e.from) ?? 0) + 1);
  importerCount.set(e.to, (importerCount.get(e.to) ?? 0) + 1);
}

const outFiles = paths.map((p, i) => {
  const f = parsed.get(p)!;
  const entry = isEntry(p);
  // Syntactic fallback only: value exports nothing imports by name. Types are
  // excluded because their uses are invisible without a checker — better to
  // under-report than to claim a live type is dead.
  const candidates =
    namespaceConsumed.has(p) || entry
      ? []
      : f.exports.filter((e) => !e.typeOnly && !consumed.has(`${p}#${e.name}`)).map((e) => e.name);
  const unusedExports = deadCode.authoritative ? (deadCode.unusedExports.get(p) ?? []) : candidates;
  const orphan = deadCode.authoritative
    ? deadCode.unusedFiles.has(p)
    : !entry && (importerCount.get(i) ?? 0) === 0;
  return {
    path: p,
    size: f.size,
    status: orphan
      ? "unused"
      : unusedExports.length > 0
        ? "hasUnusedExports"
        : entry
          ? "entryPoint"
          : "clean",
    export_count: f.exports.length,
    unused_export_count: unusedExports.length,
    unused_exports: unusedExports,
    is_entry: entry,
    importer_count: importerCount.get(i) ?? 0,
    import_count: importCount.get(i) ?? 0,
    zone: zoneIdx.get(zoneOf(p))!,
    fn_count: f.fnCount,
    max_cyclomatic: Math.max(0, ...f.functions.map((x) => x.cyclomatic)),
    max_cognitive: Math.max(0, ...f.functions.map((x) => x.cognitive)),
    in_cycle: inCycle.has(i),
    functions: f.functions,
  };
});

const codegraph = {
  generatedAt: new Date().toISOString(),
  generator: "oxgraph (oxc-parser + oxc-resolver)",
  deadCodeSource: deadCode.authoritative
    ? "fallow dead-code (checker-grade)"
    : "syntactic candidates (fallow unavailable)",
  root: path.basename(repoRoot),
  summary: {
    total_files: outFiles.length,
    total_edges: edgeMap.size,
    circular_deps: cycles.length,
    boundary_violations: violations.length,
  },
  files: outFiles,
  edges: [...edgeMap.values()].map((e) => [e.from, e.to, e.typeOnly ? 1 : 0]),
  workspaces: [],
  zones: zoneNames.map((name) => ({ name, files: paths.filter((p) => zoneOf(p) === name).length })),
  cycles,
  violations,
};

fs.writeFileSync(OUT, JSON.stringify(codegraph));
console.log(
  `✓ oxgraph: ${outFiles.length} files, ${edgeMap.size} edges, ${cycles.length} cycles, ` +
    `${violations.length} boundary violations, ` +
    `${outFiles.reduce((n, f) => n + f.unused_export_count, 0)} unused exports ` +
    `(${deadCode.authoritative ? "fallow-verified" : "syntactic"}) → ${OUT}`,
);
