#!/usr/bin/env bun
/**
 * brand-lint — guards against brand/hex literals leaking into component
 * source instead of living in src/tokens/brand.ts.
 *
 * Checks, per file under the scanned directories:
 *   (a) hex color literals (#abc, #aabbcc, #aabbccdd) outside the
 *       brand-surface allowlist.
 *   (b) Tailwind color utilities (bg-/text-/border-/ring-/fill-/stroke-/
 *       from-/via-/to-<token>) whose <token> is not one of the semantic
 *       contract names (src/tokens/colors.ts) and not one of the
 *       consumer's own palette token names (src/tokens/brand.ts ramps).
 *       --strict-semantic narrows this to semantic-only (for @si/ui
 *       component directories, which must never reach for a raw palette
 *       step).
 *   (c) known brand strings, passed via one or more --brand-word flags.
 *
 * Usage:
 *   bun run scripts/brand-lint.ts <dir> [<dir> ...] [options]
 *
 * Options:
 *   --allow <glob>         Add an allowlist glob for hex-literal checks
 *                          (repeatable). Defaults: the design brand
 *                          surface, the ui logo module, og assets.
 *   --brand-word <word>    Flag this string anywhere in scanned files
 *                          (repeatable, case-insensitive).
 *   --strict-semantic       Only semantic contract tokens are legal in
 *                          Tailwind color utilities (ignores the
 *                          consumer's custom palette names).
 *   --ext <.tsx,.ts,...>   Comma-separated extensions to scan
 *                          (default: .ts,.tsx,.css).
 *   --help                 Print this message and exit 0.
 *
 * Exit code: 1 if any violation is found, 0 otherwise.
 */

import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";

const HELP = `brand-lint — scan a tree for brand/hex literals outside the brand surface

Usage:
  bun run scripts/brand-lint.ts <dir> [<dir> ...] [options]

Options:
  --allow <glob>        Add an allowlist glob for hex literals (repeatable)
  --brand-word <word>   Flag this string anywhere in scanned files (repeatable)
  --strict-semantic     Only semantic contract tokens are legal in
                        Tailwind color utilities (use for ui component dirs)
  --ext <.tsx,.ts,...>  Comma-separated extensions to scan (default: .ts,.tsx,.css)
  --help                Print this message and exit 0
`;

// ============================================
// The fixed semantic contract (src/tokens/colors.ts) — always legal.
// ============================================

const SEMANTIC_TOKENS = new Set([
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "primary-hover",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "destructive-hover",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "border",
  "border-strong",
  "input",
  "ring",
  "surface-sunken",
  "surface-raised",
  "inverse",
  "inverse-foreground",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
]);

/** Tailwind keywords that are structural, never brand-specific. */
// black/white cover the standard shadcn overlay dims (bg-black/50).
/** Font-size token names from the generated tailwind theme (text-<name> = size). */
const fontSizeTokens = (() => {
  const out = new Set<string>();
  try {
    const css = readFileSync(
      new URL("../generated/css/tailwind-theme.css", import.meta.url),
      "utf8",
    );
    for (const mm of css.matchAll(/--text-([a-z0-9-]+?)(?:--[a-z-]+)?:/g)) out.add(mm[1]!);
  } catch {
    // generated theme absent (pre-codegen checkout) — sizes just aren't allowlisted
  }
  return out;
})();

const STRUCTURAL_KEYWORDS = new Set(["transparent", "current", "inherit", "black", "white"]);

/**
 * Non-color suffixes for the same prefixes we scan (text-/border-/ring-/…
 * are heavily overloaded in Tailwind — `text-lg` is a font size, not a
 * color). This is a heuristic list, not a full Tailwind grammar: if a
 * project hits a false positive, add the file to --allow or widen this
 * set rather than fighting the regex.
 */
const NON_COLOR_KEYWORDS = new Set([
  // Type scale
  "xs",
  "sm",
  "base",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
  // Text alignment / wrapping / decoration / transform
  "left",
  "center",
  "right",
  "justify",
  "start",
  "end",
  "nowrap",
  "wrap",
  "balance",
  "pretty",
  "ellipsis",
  "clip",
  "underline",
  "overline",
  "line-through",
  "no-underline",
  "uppercase",
  "lowercase",
  "capitalize",
  "normal-case",
  "italic",
  "not-italic",
  // Border / ring / stroke geometry (not color)
  "solid",
  "dashed",
  "dotted",
  "double",
  "none",
  "hidden",
  "collapse",
  "separate",
  "inset",
  "dasharray",
  "dashoffset",
  "linecap",
  "linejoin",
  "miterlimit",
]);

const DEFAULT_ALLOW_GLOBS = [
  "src/tokens/brand.ts",
  "**/logo/brand.ts",
  "**/logo/logo.tsx",
  "**/logo/logo-animated.tsx",
  "**/logo/logo-icon.tsx",
  "**/og/**",
  "**/*-brand.tsx",
  "**/app-brand.ts",
];

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".css"];

// ============================================
// Tiny dependency-free glob matcher — supports `**`, `*`, and literal
// path segments. Good enough for the allowlist shapes above.
// ============================================

function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      out += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else if (c && ".+^${}()|[]\\".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`(^|/)${out}$`);
}

function matchesAny(path: string, globs: string[]): boolean {
  const normalized = path.replace(/\\/g, "/");
  return globs.some((g) => globToRegExp(g).test(normalized));
}

// ============================================
// Palette token names — read from the consumer's src/tokens/brand.ts so
// custom tokens they add stay legal in APP code (not --strict-semantic).
// ============================================

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** Parse `export const <name>Ramp = { <numeric keys> ... } as const;`
 *  blocks out of a brand.ts source string, producing utility names like
 *  "neutral-500", "accent-600". Regex-based on purpose: dependency-free,
 *  no TS compiler on hand. */
export function extractPaletteTokenNames(brandSource: string): Set<string> {
  const names = new Set<string>();
  const rampRe = /export\s+const\s+(\w+)Ramp\s*=\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rampRe.exec(brandSource))) {
    const rampName = camelToKebab(m[1]!);
    const body = m[2]!;
    const stepRe = /(\d+)\s*:/g;
    let s: RegExpExecArray | null;
    while ((s = stepRe.exec(body))) {
      names.add(`${rampName}-${s[1]}`);
    }
  }
  return names;
}

async function readPaletteTokenNames(designRoot: string): Promise<Set<string>> {
  try {
    const src = await readFile(join(designRoot, "src/tokens/brand.ts"), "utf8");
    return extractPaletteTokenNames(src);
  } catch {
    return new Set();
  }
}

// ============================================
// File walking
// ============================================

async function walk(dir: string, extensions: string[]): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "generated" || entry.name.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full, extensions)));
    } else if (extensions.includes(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

// ============================================
// Checks
// ============================================

export interface Violation {
  file: string;
  line: number;
  rule: "hex-literal" | "non-semantic-utility" | "brand-word";
  message: string;
}

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

const UTILITY_PREFIXES = ["bg", "text", "border", "ring", "fill", "stroke", "from", "via", "to"];
// e.g. bg-primary, hover:text-destructive-hover, dark:border-neutral-200/40
const UTILITY_RE = new RegExp(
  `(?:^|[\\s"'\`{])(?:[\\w-]+:)*(${UTILITY_PREFIXES.join("|")})-([a-zA-Z][a-zA-Z0-9-]*?)(?:\\/\\d{1,3})?(?=[\\s"'\`}]|$)`,
  "g",
);

function checkHexLiterals(file: string, content: string, allowGlobs: string[]): Violation[] {
  if (matchesAny(file, allowGlobs)) return [];
  const violations: Violation[] = [];
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    HEX_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HEX_RE.exec(line))) {
      violations.push({
        file,
        line: idx + 1,
        rule: "hex-literal",
        message: `hex color literal ${m[0]} outside the brand surface`,
      });
    }
  });
  return violations;
}

function checkUtilities(file: string, content: string, legalTokens: Set<string>): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    UTILITY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = UTILITY_RE.exec(line))) {
      const token = m[2]!;
      if (STRUCTURAL_KEYWORDS.has(token)) continue;
      if (NON_COLOR_KEYWORDS.has(token)) continue;
      // Purely numeric suffixes (border-2, from-0%) or offset-<n> (ring-offset-2)
      // are Tailwind sizing/geometry utilities, not color tokens.
      if (/^\d/.test(token)) continue;
      if (/^offset-\d/.test(token)) continue;
      // ring-offset-<color>: strip the offset segment and re-check the color.
      if (token.startsWith("offset-") && legalTokens.has(token.slice("offset-".length))) continue;
      if (/^gradient-to-/.test(token)) continue; // gradient direction, not a color
      if (/^blend-/.test(token)) continue; // bg-blend-* / mix-blend-* modes
      // Font-size tokens from the generated tailwind theme (`--text-<name>`)
      // make text-<name> a size utility, not a color.
      if (m[1] === "text" && fontSizeTokens.has(token)) continue;
      // Side/axis variants (border-b-2, border-b-primary): strip the axis
      // segment — numeric remainders are widths, token remainders re-check.
      if (/^[a-z]{1,2}$/.test(token)) continue; // bare side/axis width: border-t, border-b
      const side = token.match(/^[a-z]{1,2}-(.+)$/);
      if (side && (/^\d/.test(side[1]!) || legalTokens.has(side[1]!))) continue;
      if (legalTokens.has(token)) continue;
      violations.push({
        file,
        line: idx + 1,
        rule: "non-semantic-utility",
        message: `"${m[1]}-${token}" is not a semantic token${legalTokens === SEMANTIC_TOKENS ? "" : " or a declared palette token"}`,
      });
    }
  });
  return violations;
}

function checkBrandWords(file: string, content: string, brandWords: string[]): Violation[] {
  if (brandWords.length === 0) return [];
  const violations: Violation[] = [];
  const lines = content.split("\n");
  const lowerWords = brandWords.map((w) => w.toLowerCase());
  lines.forEach((line, idx) => {
    const lower = line.toLowerCase();
    for (let i = 0; i < lowerWords.length; i++) {
      if (lower.includes(lowerWords[i]!)) {
        violations.push({
          file,
          line: idx + 1,
          rule: "brand-word",
          message: `known brand string "${brandWords[i]}" found`,
        });
      }
    }
  });
  return violations;
}

export interface LintOptions {
  dirs: string[];
  allowGlobs?: string[];
  brandWords?: string[];
  strictSemantic?: boolean;
  extensions?: string[];
  /** Root of the design package, for reading src/tokens/brand.ts. Defaults
   *  to the first scanned dir that contains src/tokens/brand.ts, else the
   *  directory this script lives in. */
  designRoot?: string;
}

export async function lintTree(opts: LintOptions): Promise<Violation[]> {
  const extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
  const allowGlobs = opts.allowGlobs ?? DEFAULT_ALLOW_GLOBS;
  const brandWords = opts.brandWords ?? [];
  const designRoot = opts.designRoot ?? new URL("..", import.meta.url).pathname;

  const paletteNames = opts.strictSemantic
    ? new Set<string>()
    : await readPaletteTokenNames(designRoot);
  const legalTokens = new Set([...SEMANTIC_TOKENS, ...paletteNames]);

  const violations: Violation[] = [];
  for (const dir of opts.dirs) {
    const files = await walk(dir, extensions);
    for (const file of files) {
      const content = await readFile(file, "utf8");
      const rel = relative(process.cwd(), file);
      violations.push(...checkHexLiterals(rel, content, allowGlobs));
      violations.push(...checkUtilities(rel, content, legalTokens));
      violations.push(...checkBrandWords(rel, content, brandWords));
    }
  }
  return violations;
}

// ============================================
// CLI
// ============================================

function parseArgs(argv: string[]) {
  const dirs: string[] = [];
  const allow: string[] = [];
  const brandWords: string[] = [];
  let strictSemantic = false;
  let ext = DEFAULT_EXTENSIONS.join(",");
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--allow") {
      allow.push(argv[++i]!);
    } else if (arg === "--brand-word") {
      brandWords.push(argv[++i]!);
    } else if (arg === "--strict-semantic") {
      strictSemantic = true;
    } else if (arg === "--ext") {
      ext = argv[++i]!;
    } else if (!arg.startsWith("-")) {
      dirs.push(arg);
    }
  }

  return { dirs, allow, brandWords, strictSemantic, ext, help };
}

async function main() {
  const { dirs, allow, brandWords, strictSemantic, ext, help } = parseArgs(process.argv.slice(2));

  if (help) {
    console.log(HELP);
    process.exit(0);
  }

  if (dirs.length === 0) {
    console.error("brand-lint: at least one directory is required.\n");
    console.log(HELP);
    process.exit(1);
  }

  const violations = await lintTree({
    dirs,
    allowGlobs: allow.length > 0 ? allow : undefined,
    brandWords,
    strictSemantic,
    extensions: ext.split(",").map((e) => e.trim()),
  });

  if (violations.length === 0) {
    console.log(`brand-lint: clean (${dirs.join(", ")})`);
    process.exit(0);
  }

  console.error(`brand-lint: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.message}`);
  }
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
