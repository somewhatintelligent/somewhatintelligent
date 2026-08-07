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

const viewmodel = {
  title: "somewhatintelligent — software topology",
  stage: topology.stage,
  generatedAt: topology.generatedAt,
  systems,
  nodes: collapsedNodes,
  edges: finalEdges,
  components: commerceComponents,
};

// ── Emit ───────────────────────────────────────────────────────────────────

const css = fs.readFileSync(path.join(dir, "viewer.css"), "utf8");
const js = fs.readFileSync(path.join(dir, "viewer.js"), "utf8");

const html = `<title>somewhatintelligent — C4 topology</title>
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
