/**
 * Does `bae` reach a deployment framework at RUNTIME? A gate that actually holds.
 *
 * The package's central claim is that it is resource-agnostic — that a
 * configuration written against `Contract.ts` knows nothing about what backs it,
 * and that swapping Cloudflare for AWS is swapping a Layer in a DIFFERENT
 * package. A claim like that is worth exactly as much as its enforcement, so
 * this checks the EMITTED JS of every entry point rather than the source.
 *
 * ## The setting is load-bearing, and the obvious one is wrong
 *
 * The natural way to write this is `Bun.build({ external: ["*"] })` and then
 * read the surviving imports. That is broken: `"*"` externalises RELATIVE
 * specifiers too, so a barrel re-export keeps `./barrel.ts` as an import instead
 * of inlining it, and everything the barrel pulls in is invisible. A module
 * re-exporting `alchemy/Cloudflare` through a barrel PASSES such a check.
 *
 * `packages: "external"` is correct: bare specifiers stay external (so we can
 * see them), relative ones are bundled (so transitives cannot hide).
 *
 * This script proves that with its own control, so the gate is not trusted on
 * assertion. If the control ever stops catching the barrel case, the whole run
 * fails — a gate that cannot fail is worse than no gate, because it reads as
 * evidence.
 *
 * Run: bun run scripts/check-purity.ts
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TMP = join(ROOT, ".purity");

/** A specifier `bae` may never reach at runtime. */
const FORBIDDEN = [
  /^alchemy(\/|$)/,
  /^cloudflare:/,
  /^@aws-sdk\//,
  /^node:(fs|child_process|net|http|https)/,
];

/** What `bae` IS allowed to reach. Anything else is a new dependency to justify. */
const ALLOWED = [/^effect(\/|$)/, /^better-auth(\/|$)/, /^@better-auth\//, /^node:async_hooks$/];

interface Result {
  readonly specifiers: ReadonlyArray<string>;
  readonly forbidden: ReadonlyArray<string>;
  readonly unexpected: ReadonlyArray<string>;
}

const inspect = async (entry: string, mode: "correct" | "broken"): Promise<Result> => {
  const built = await Bun.build({
    entrypoints: [entry],
    target: "node",
    ...(mode === "correct" ? { packages: "external" as const } : { external: ["*"] }),
  });
  if (!built.success) throw new AggregateError(built.logs, `build failed for ${entry}`);

  const code = await built.outputs[0]!.text();
  const specifiers = [
    ...[...code.matchAll(/(?:^|\n)\s*import\s[^"']*["']([^"']+)["']/g)].map((m) => m[1]!),
    ...[...code.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]!),
    ...[...code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]!),
  ];
  const unique = [...new Set(specifiers)].sort();
  return {
    specifiers: unique,
    forbidden: unique.filter((s) => FORBIDDEN.some((re) => re.test(s))),
    unexpected: unique.filter((s) => !s.startsWith(".") && !ALLOWED.some((re) => re.test(s))),
  };
};

let failed = false;

// ── the control: a module that hides a forbidden import behind a barrel ──────
mkdirSync(TMP, { recursive: true });
writeFileSync(join(TMP, "barrel.ts"), `export * as Cloudflare from "alchemy/Cloudflare";\n`);
writeFileSync(
  join(TMP, "hides-alchemy.ts"),
  `import { Cloudflare } from "./barrel.ts";\nexport const leak = () => Cloudflare;\n`,
);

console.log("=== control: a module that reaches alchemy through a barrel ===");
const control = join(TMP, "hides-alchemy.ts");
const broken = await inspect(control, "broken");
const correct = await inspect(control, "correct");
console.log(`  external:["*"]      -> ${JSON.stringify(broken.specifiers)}`);
console.log(
  `                         forbidden: ${broken.forbidden.length}` +
    (broken.forbidden.length === 0
      ? "   <- MISSED IT (this is the bug being guarded against)"
      : ""),
);
console.log(`  packages:"external" -> ${JSON.stringify(correct.specifiers)}`);
console.log(
  `                         forbidden: ${correct.forbidden.length}` +
    (correct.forbidden.length > 0 ? "   <- caught" : "   <- CONTROL FAILED"),
);
if (correct.forbidden.length === 0) {
  console.error(
    "\nCONTROL FAILED: the checker cannot see a barrel-hidden import. Gate is worthless.",
  );
  failed = true;
}

// ── the real entry points ───────────────────────────────────────────────────
const ENTRIES = ["index.ts", "Boundary.ts", "Contract.ts", "Auth.ts", "Handler.ts", "Tracing.ts"];

console.log("\n=== bae entry points ===");
for (const name of ENTRIES) {
  const result = await inspect(join(ROOT, "src", name), "correct");
  const problems = [
    ...result.forbidden.map((s) => `FORBIDDEN ${s}`),
    ...result.unexpected.map((s) => `UNDECLARED ${s}`),
  ];
  if (problems.length > 0) {
    console.log(`  FAIL  src/${name}  ${problems.join(", ")}`);
    failed = true;
  } else {
    console.log(`  ok    src/${name}  -> ${JSON.stringify(result.specifiers)}`);
  }
}

rmSync(TMP, { recursive: true, force: true });
console.log(failed ? "\nPURITY GATE FAILED" : "\nPURITY GATE PASSED (control proved it can fail)");
process.exit(failed ? 1 : 0);
