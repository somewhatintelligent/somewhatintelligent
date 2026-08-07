/**
 * topology.json + model.ts → one self-contained index.html.
 *
 * The page embeds the merged viewmodel as JSON and inlines viewer.css /
 * viewer.js, so the output renders anywhere with zero network access
 * (Artifact CSP-safe). Run:
 *
 *   bun prototypes/c4-topology/generate.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { actors, assertedEdges, commerceComponents, nodes as nodeMeta, systems } from "./model.ts";

const dir = path.dirname(new URL(import.meta.url).pathname);
const topology = JSON.parse(fs.readFileSync(path.join(dir, "topology.json"), "utf8"));

// ── Merge extraction with the overlay ──────────────────────────────────────

const metaByKey = new Map(nodeMeta.map((m) => [m.key, m]));

interface VmNode {
  key: string;
  name: string;
  stack: string;
  fqn?: string;
  type?: string;
  role: string;
  description: string;
  technology: string;
  domain?: string;
  serviceName?: string;
  extracted: boolean;
  exported?: boolean;
  props?: unknown;
}

const vmNodes: VmNode[] = [];

for (const n of topology.nodes) {
  const key = `${n.stack}/${n.fqn}`;
  const meta = metaByKey.get(key);
  vmNodes.push({
    key,
    name: meta?.name ?? n.logicalId,
    stack: n.stack,
    fqn: n.fqn,
    type: n.type,
    role: meta?.role ?? "compute",
    description: meta?.description ?? "",
    technology: meta?.technology ?? n.type ?? "",
    domain: meta?.domain,
    serviceName: meta?.serviceName,
    extracted: true,
    exported: n.exported,
    props: n.props,
  });
}
// Synthetic nodes (foundation stacks, externals, actors) come from the overlay.
for (const m of [...nodeMeta, ...actors]) {
  if (vmNodes.some((v) => v.key === m.key)) continue;
  const stack = m.key.startsWith("actor/") ? "actors" : m.key.split("/")[0]!;
  vmNodes.push({
    key: m.key,
    name: m.name,
    stack,
    role: m.role,
    description: m.description,
    technology: m.technology,
    domain: m.domain,
    serviceName: m.serviceName,
    extracted: false,
  });
}

interface VmEdge {
  from: string; // dependent / initiator (drawn as arrow source)
  to: string; // dependency / receiver
  label: string;
  technology?: string;
  provenance: "extracted" | "asserted";
  detail?: string; // prop path or code evidence
}

const labelFromPath = (p: string): string => {
  if (p.startsWith("binding:")) return `binds ${p.slice(8)}`;
  if (p.startsWith("env.")) return `env ${p.slice(4)}`;
  if (p === "migrationsDir") return "applies migrations";
  if (p === "queueId") return "consumes";
  if (p === "scriptName") return "runs on";
  if (p === "command") return "forwards to";
  if (p.startsWith("allowedIdps")) return "uses IdP";
  if (p.startsWith("policies")) return "uses policy";
  return p;
};

const vmEdges: VmEdge[] = [];
for (const e of topology.edges) {
  // extract.ts records dependency → dependent; C4 reads "dependent uses
  // dependency", so flip for display.
  vmEdges.push({
    from: e.to,
    to: e.from,
    label: labelFromPath(e.path),
    technology:
      e.kind === "binding" || e.path.startsWith("binding:")
        ? "service binding"
        : e.kind === "cross-stack"
          ? "cross-stack ref"
          : undefined,
    provenance: "extracted",
    detail: `${e.kind} @ ${e.path}`,
  });
}
for (const a of assertedEdges) {
  vmEdges.push({
    from: a.from,
    to: a.to,
    label: a.label,
    technology: a.technology,
    provenance: "asserted",
    detail: a.evidence,
  });
}

// Queue consumers are wiring, not containers: collapse each into a direct
// "consumes" edge from the worker it runs on to the queue it drains.
const consumerKeys = new Set(
  vmNodes.filter((n) => (n.type ?? "").endsWith("Queues.Consumer")).map((n) => n.key),
);
for (const key of consumerKeys) {
  const queue = vmEdges.find((e) => e.from === key && e.detail?.includes("queueId"))?.to;
  const worker = vmEdges.find((e) => e.from === key && e.detail?.includes("scriptName"))?.to;
  if (queue && worker) {
    vmEdges.push({
      from: worker,
      to: queue,
      label: "consumes",
      technology: "queue consumer",
      provenance: "extracted",
      detail: `collapsed ${key}`,
    });
  }
}
const collapsedNodes = vmNodes.filter((n) => !consumerKeys.has(n.key));
const collapsedEdges = vmEdges.filter((e) => !consumerKeys.has(e.from) && !consumerKeys.has(e.to));

// Drop edges pointing at nodes we don't model, then dedupe by rendered identity.
const known = new Set(collapsedNodes.map((n) => n.key));
for (const e of collapsedEdges) {
  if (!known.has(e.from) || !known.has(e.to)) {
    console.warn(`dropping edge with unknown endpoint: ${e.from} → ${e.to}`);
  }
}
const finalEdges = [
  ...new Map(
    collapsedEdges
      .filter((e) => known.has(e.from) && known.has(e.to))
      .map((e) => [`${e.from}→${e.to}#${e.label}`, e]),
  ).values(),
];

// ── Code graph (C4 levels 3–4, lifted from fallow via codegraph.ts) ────────
//
// The link between the IaC level and the code level is mechanical: every
// Worker's extracted props carry `main` (entry file) or `rootDir`. BFS over
// fallow's import graph from that anchor yields the container's code closure;
// folders become L3 components, files (with fallow's per-function metrics)
// become L4 code elements.

interface CgFile {
  path: string;
  size: number;
  status: string;
  export_count: number;
  unused_export_count: number;
  is_entry: boolean;
  importer_count: number;
  import_count: number;
  zone: number;
  fn_count: number;
  max_cyclomatic: number;
  max_cognitive: number;
  in_cycle: boolean;
  functions?: {
    name: string;
    line: number;
    cyclomatic: number;
    cognitive: number;
    lines: number;
  }[];
}

const codegraphPath = path.join(dir, "codegraph.json");
const codegraph = fs.existsSync(codegraphPath)
  ? (JSON.parse(fs.readFileSync(codegraphPath, "utf8")) as {
      generator?: string;
      deadCodeSource?: string;
      files: CgFile[];
      edges: [number, number, number][];
      zones: { name: string; files: number }[];
      violations: {
        from: number;
        to: number;
        from_zone: number;
        to_zone: number;
        line: number;
        specifier: string;
      }[];
    })
  : undefined;

interface CodeContainer {
  appRoot: string;
  entry?: string;
  components: { id: string; label: string; files: number[]; entry: boolean; pkg: boolean }[];
  edges: { from: string; to: string; n: number; typeOnly: boolean }[];
}

const code: {
  generator: string;
  deadCodeSource?: string;
  files: CgFile[];
  edges: [number, number, number][];
  containers: Record<string, CodeContainer>;
  violations: {
    fromPath: string;
    toPath: string;
    line: number;
    fromZone: string;
    toZone: string;
  }[];
} = { generator: "fallow viz", files: [], edges: [], containers: {}, violations: [] };

if (codegraph) {
  if (codegraph.generator) code.generator = codegraph.generator;
  if (codegraph.deadCodeSource) code.deadCodeSource = codegraph.deadCodeSource;
  const cgFiles = codegraph.files;
  const byPath = new Map(cgFiles.map((f, i) => [f.path, i]));
  const outEdges = new Map<number, number[]>();
  for (const [from, to] of codegraph.edges) {
    if (!outEdges.has(from)) outEdges.set(from, []);
    outEdges.get(from)!.push(to);
  }

  const rel = (p: string) =>
    p
      .replace(/^file:\/\//, "")
      .replace(/^\/home\/[^/]+\/somewhatintelligent\//, "")
      .replace(/^.*?(?=apps\/|packages\/|infra\/)/, "");

  const closureFrom = (seeds: number[]) => {
    const seen = new Set<number>(seeds);
    const queue = [...seeds];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of outEdges.get(cur) ?? []) {
        if (seen.has(next) || cgFiles[next]!.path.startsWith("prototypes/")) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return [...seen];
  };

  // Component id for a file within a container rooted at appRoot: the first
  // two app-relative path segments for in-app files; whole-package nodes for
  // workspace deps; "infra" for the shared stacks layer.
  const componentOf = (p: string, appRoot: string) => {
    if (p.startsWith(appRoot + "/")) {
      const parts = p.slice(appRoot.length + 1).split("/");
      return parts.length === 1 ? "(root)" : parts.slice(0, -1).slice(0, 2).join("/");
    }
    if (p.startsWith("packages/")) return p.split("/").slice(0, 2).join("/");
    if (p.startsWith("infra/")) return "infra";
    if (p.startsWith("apps/")) return p.split("/").slice(0, 2).join("/") + " (app)";
    return "(external)";
  };

  const usedFiles = new Set<number>();
  const containerAnchors: Record<string, { entry?: string; root?: string }> = {};
  for (const n of collapsedNodes) {
    const props = (n.props ?? {}) as Record<string, unknown>;
    if (typeof props.main === "string") containerAnchors[n.key] = { entry: rel(props.main) };
    else if (typeof props.rootDir === "string")
      containerAnchors[n.key] = { root: rel(props.rootDir) };
  }

  for (const [key, anchor] of Object.entries(containerAnchors)) {
    const appRoot = (anchor.entry ?? anchor.root)!.split("/").slice(0, 2).join("/");
    const seeds = anchor.entry
      ? [byPath.get(anchor.entry)].filter((i): i is number => i !== undefined)
      : cgFiles.flatMap((f, i) => (f.path.startsWith(anchor.root! + "/") ? [i] : []));
    if (seeds.length === 0) {
      console.warn(`code: no seed files for ${key} (${JSON.stringify(anchor)})`);
      continue;
    }
    const closure = closureFrom(seeds);
    closure.forEach((i) => usedFiles.add(i));

    const comps = new Map<string, { files: number[]; entry: boolean }>();
    for (const i of closure) {
      const id = componentOf(cgFiles[i]!.path, appRoot);
      if (!comps.has(id)) comps.set(id, { files: [], entry: false });
      comps.get(id)!.files.push(i);
      if (anchor.entry && cgFiles[i]!.path === anchor.entry) comps.get(id)!.entry = true;
    }
    const compOf = new Map(
      closure.flatMap((i) => [[i, componentOf(cgFiles[i]!.path, appRoot)] as const]),
    );
    // edge flag bit0: every import on the edge is type-only (fallow VizData contract)
    const agg = new Map<string, { n: number; typeOnly: number }>();
    for (const [from, to, flags] of codegraph.edges) {
      const a = compOf.get(from);
      const b = compOf.get(to);
      if (!a || !b || a === b) continue;
      const k = `${a}→${b}`;
      if (!agg.has(k)) agg.set(k, { n: 0, typeOnly: 0 });
      agg.get(k)!.n += 1;
      if (flags & 1) agg.get(k)!.typeOnly += 1;
    }
    code.containers[key] = {
      appRoot,
      entry: anchor.entry,
      components: [...comps.entries()].map(([id, c]) => ({
        id,
        label: id,
        files: c.files,
        entry: c.entry,
        pkg: id.startsWith("packages/") || id === "infra" || id.endsWith("(app)"),
      })),
      edges: [...agg.entries()].map(([k, v]) => {
        const [from, to] = k.split("→");
        return { from: from!, to: to!, n: v.n, typeOnly: v.typeOnly === v.n };
      }),
    };
  }

  // Reindex the file table down to files some closure references.
  const order = [...usedFiles].sort((a, b) => a - b);
  const newIndex = new Map(order.map((old, i) => [old, i]));
  code.files = order.map((old) => {
    const f = cgFiles[old]!;
    return {
      ...f,
      functions: (f.functions ?? []).map(({ name, line, cyclomatic, cognitive, lines }) => ({
        name,
        line,
        cyclomatic,
        cognitive,
        lines,
      })),
    };
  });
  for (const container of Object.values(code.containers)) {
    for (const comp of container.components) comp.files = comp.files.map((i) => newIndex.get(i)!);
  }
  code.edges = codegraph.edges.flatMap(([from, to, flags]) => {
    const a = newIndex.get(from);
    const b = newIndex.get(to);
    return a !== undefined && b !== undefined ? [[a, b, flags] as [number, number, number]] : [];
  });
  code.violations = codegraph.violations.map((v) => ({
    fromPath: cgFiles[v.from]!.path,
    toPath: cgFiles[v.to]!.path,
    line: v.line,
    fromZone: codegraph.zones[v.from_zone]!.name,
    toZone: codegraph.zones[v.to_zone]!.name,
  }));
}

const viewmodel = {
  title: "somewhatintelligent — software topology",
  stage: topology.stage,
  generatedAt: topology.generatedAt,
  systems,
  nodes: collapsedNodes,
  edges: finalEdges,
  components: commerceComponents,
  code,
};

// ── Emit ───────────────────────────────────────────────────────────────────

const css = fs.readFileSync(path.join(dir, "viewer.css"), "utf8");
const js = fs.readFileSync(path.join(dir, "viewer.js"), "utf8");

const html = `<meta charset="utf-8" />
<title>somewhatintelligent — C4 topology</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
${css}
</style>
<div id="app"></div>
<script type="application/json" id="viewmodel">
${JSON.stringify(viewmodel).replace(/</g, "\\u003c")}
</script>
<script>
${js}
</script>
`;

const out = path.join(dir, "index.html");
fs.writeFileSync(out, html);
console.log(`✓ wrote ${out} (${(html.length / 1024).toFixed(0)} KiB)`);
