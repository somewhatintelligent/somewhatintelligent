import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The layering is what keeps `core` testable with no bindings and no Miniflare.
 * These rules are relationships between files rather than properties of any one
 * of them, so they are read from the source itself: a new file cannot join the
 * wrong layer quietly.
 */

const REPO = join(import.meta.dir, "..");
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

const sources = (zone: string): string[] =>
  (readdirSync(join(REPO, zone), { recursive: true }) as string[])
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter((entry) => SOURCE.test(entry))
    .sort();

const read = (zone: string, file: string): string => readFileSync(join(REPO, zone, file), "utf8");

const IMPORT_FORMS: readonly RegExp[] = [
  /^[ \t]*import\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^[ \t]*export\b[^;]*?\bfrom\s*["']([^"']+)["']/gm,
  /^[ \t]*import\s*["']([^"']+)["']/gm,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const importsOf = (content: string): string[] => {
  const found: string[] = [];
  for (const pattern of IMPORT_FORMS) {
    for (const [, specifier] of content.matchAll(pattern)) {
      if (specifier !== undefined) found.push(specifier);
    }
  }
  return found;
};

describe("src/core is pure", () => {
  const files = sources("src/core");

  test("there is something to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("nothing in core imports from server — the dependency only runs one way", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of importsOf(read("src/core", file))) {
        // Only a relative specifier can reach src/server; a bare one names a package.
        if (specifier.startsWith(".") && /(?:^|\/)server\//.test(specifier)) {
          violations.push(`src/core/${file} → ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("nothing in core imports a cloudflare: module — core runs anywhere", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const specifier of importsOf(read("src/core", file))) {
        if (specifier.startsWith("cloudflare:")) violations.push(`src/core/${file} → ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("core never names R2Bucket — a binding type has no business in the pure layer", () => {
    const violations = files.filter((file) => read("src/core", file).includes("R2Bucket"));
    expect(violations).toEqual([]);
  });
});

describe("the R2 bucket type stays in one place", () => {
  /**
   * A type reference is neither an import nor a call, so no import-graph rule
   * catches it. Two modules may name it: `blobs.ts`, the storage adapter, and
   * `env.ts`, which is the binding contract and has to name what it declares.
   * Everything else reaches R2 through `blobs.ts`.
   */
  const ALLOWED = new Set(["blobs.ts", "env.ts"]);
  const files = sources("src/server");

  test("there is something to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("no other module in server names R2Bucket", () => {
    const offenders = files.filter(
      (file) => !ALLOWED.has(file) && read("src/server", file).includes("R2Bucket"),
    );
    expect(offenders).toEqual([]);
  });

  test("env.ts names it only to declare the binding", () => {
    const occurrences = read("src/server", "env.ts").split("R2Bucket").length - 1;
    expect(occurrences).toBe(1);
  });
});
