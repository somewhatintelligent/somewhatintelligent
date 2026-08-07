/**
 * Lift fallow's code graph → codegraph.json (C4 levels 3–4 raw material).
 *
 * `fallow viz` embeds its complete viewmodel — per-file metrics, the import
 * edge list, workspaces, boundary zones, cycles, violations — as a
 * `__FALLOW_DATA__` JSON literal inside the generated HTML. That model is
 * richer than the dot/mermaid emitters (which carry only nodes + edges), so
 * we render the HTML to a scratch file and lift the literal back out.
 *
 * Run:  bun prototypes/c4-topology/codegraph.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const tmp = path.join(os.tmpdir(), `fallow-viz-${process.pid}.html`);

execFileSync("bunx", ["fallow", "viz", "--no-open", "--out", tmp, "-q"], {
  stdio: "inherit",
  cwd: path.resolve(dir, "../.."),
});

const html = fs.readFileSync(tmp, "utf8");
fs.rmSync(tmp, { force: true });

// Balanced-brace scan: the literal contains strings with braces, so a regex
// won't do. Strings are skipped escape-aware.
const anchor = html.indexOf("__FALLOW_DATA__");
if (anchor < 0) throw new Error("__FALLOW_DATA__ not found in fallow viz output");
const start = html.indexOf("{", anchor);
let depth = 0;
let i = start;
while (true) {
  const c = html[i];
  if (c === '"') {
    i++;
    while (html[i] !== '"' || html[i - 1] === "\\") i++;
  } else if (c === "{") depth++;
  else if (c === "}") {
    depth--;
    if (depth === 0) break;
  }
  i++;
}
const data = JSON.parse(html.slice(start, i + 1));

// Keep what the diagram needs; drop clone previews (large source excerpts).
const codegraph = {
  generatedAt: new Date().toISOString(),
  root: data.root,
  summary: data.summary,
  files: data.files,
  edges: data.edges,
  workspaces: data.workspaces,
  zones: data.zones,
  cycles: data.cycles,
  violations: data.violations,
};

const out = path.join(dir, "codegraph.json");
fs.writeFileSync(out, JSON.stringify(codegraph));
console.log(
  `✓ ${codegraph.files.length} files, ${codegraph.edges.length} edges, ` +
    `${codegraph.zones.length} zones, ${codegraph.violations.length} violations → ${out}`,
);
