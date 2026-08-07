/* somewhatintelligent C4 viewer — vanilla JS, no dependencies.
 *
 * Structure: data → issue model → view registry → graph builders → layout →
 * render (topbar/rail/canvas/inspector/search) → interactions.
 *
 * The organizing idea: code-level health rolls UP. A dead export found in one
 * file is counted on its module, its container, and its system, so the
 * landscape answers "where are the problems?" before you have drilled
 * anywhere, and every level down narrows the same question.
 */
"use strict";

const VM = JSON.parse(document.getElementById("viewmodel").textContent);
const SVG_NS = "http://www.w3.org/2000/svg";
const CODE = VM.code ?? { files: [], edges: [], containers: {}, violations: [] };
const CODE_SOURCE = (CODE.generator ?? "fallow").split(" ")[0];

// ── helpers ────────────────────────────────────────────────────────────────

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter(Boolean));
  return node;
};
const svgEl = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
  node.append(...children.filter(Boolean));
  return node;
};
const wrap = (text, maxChars, maxLines) => {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if ((line + " " + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else line = (line + " " + word).trim();
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && line) lines[maxLines - 1] += "…";
  return lines;
};
const basename = (p) => p.split("/").pop();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const nodeByKey = new Map(VM.nodes.map((n) => [n.key, n]));

/**
 * Every composite id in one place. Component ids contain "/" and could contain
 * ":", so the tail is always rejoined rather than destructured — three call
 * sites used to disagree about that.
 */
const Key = {
  system: (stack) => "sys:" + stack,
  codeMap: (container) => "code:" + container,
  codeFiles: (container, comp) => `codefiles:${container}:${comp}`,
  component: (container, comp) => `codecomp:${container}:${comp}`,
  file: (index) => "codefile:" + index,
  parse(id) {
    const [kind, container, ...rest] = id.split(":");
    if (kind === "codefile") return { kind, index: Number(container) };
    if (kind === "code") return { kind, container: [container, ...rest].join(":") };
    if (kind === "codefiles" || kind === "codecomp") {
      return { kind, container, comp: rest.join(":") };
    }
    if (kind === "system" || kind === "sys")
      return { kind: "system", stack: rest.length ? [container, ...rest].join(":") : container };
    return { kind: id };
  },
};
const systemByStack = new Map(VM.systems.map((s) => [s.stack, s]));
const displayName = (key) => nodeByKey.get(key)?.name ?? key;

// ── issue model ────────────────────────────────────────────────────────────
//
// One vocabulary of problems, computed once per file, then summed up the
// hierarchy. `severity` drives color; `label` always carries the meaning in
// words so color is never the only channel.

const COMPLEX_AT = 10; // cyclomatic — worth a look
const HOTSPOT_AT = 20; // cyclomatic — hard to hold in your head

const SEVERITY_RANK = { critical: 0, warn: 1, ok: 2 };

const ISSUE_KINDS = {
  violation: { label: "boundary violation", short: "breach", severity: "critical" },
  cycle: { label: "import cycle", short: "cycle", severity: "critical" },
  hotspot: { label: "complexity hotspot", short: "hotspot", severity: "critical" },
  dead: { label: "dead export", short: "dead", severity: "warn" },
  orphan: { label: "unreferenced file", short: "orphan", severity: "warn" },
  complex: { label: "complex function", short: "complex", severity: "warn" },
};

/** The one complexity ladder — chips and the inspector both read it. */
const severityOfComplexity = (cyclomatic) =>
  cyclomatic >= HOTSPOT_AT ? "critical" : cyclomatic >= COMPLEX_AT ? "warn" : "ok";

/** Issue counts for one file, as {kind: n}. */
const fileIssues = (f) => {
  const counts = {};
  if (f.unused_export_count > 0) counts.dead = f.unused_export_count;
  if (f.status === "unused") counts.orphan = 1;
  if (f.in_cycle) counts.cycle = 1;
  const complexity = severityOfComplexity(f.max_cyclomatic);
  if (complexity === "critical") counts.hotspot = 1;
  else if (complexity === "warn") counts.complex = 1;
  return counts;
};

const addCounts = (into, from) => {
  for (const [kind, n] of Object.entries(from)) into[kind] = (into[kind] ?? 0) + n;
  return into;
};

const FILE_ISSUES = CODE.files.map(fileIssues);

// Boundary violations are edges, so they attach to the file that reaches
// across — counted once per source file.
const violationFiles = new Set(CODE.violations.map((v) => v.fromPath));
CODE.files.forEach((f, i) => {
  if (violationFiles.has(f.path)) addCounts(FILE_ISSUES[i], { violation: 1 });
});

const issuesOfFiles = (indexes) =>
  indexes.reduce((acc, i) => addCounts(acc, FILE_ISSUES[i] ?? {}), {});

/** A container's own code — imported workspace packages are context, not scope. */
const ownComponents = (container) => container.components.filter((c) => !c.pkg);
const ownFiles = (container) => ownComponents(container).flatMap((c) => c.files);

/** Rolled-up issues per container key ("Stack/FQN") and per system stack. */
const CONTAINER_ISSUES = new Map();
const SYSTEM_FILES = new Map(); // deduped: containers in one system share files
for (const [key, container] of Object.entries(CODE.containers)) {
  const own = ownFiles(container);
  CONTAINER_ISSUES.set(key, issuesOfFiles(own));
  const stack = key.split("/")[0];
  if (!SYSTEM_FILES.has(stack)) SYSTEM_FILES.set(stack, new Set());
  for (const i of own) SYSTEM_FILES.get(stack).add(i);
}
const SYSTEM_ISSUES = new Map(
  [...SYSTEM_FILES].map(([stack, files]) => [stack, issuesOfFiles([...files])]),
);

const totalIssues = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
const worstSeverity = (counts) =>
  Object.keys(counts).reduce(
    (worst, kind) =>
      SEVERITY_RANK[ISSUE_KINDS[kind].severity] < SEVERITY_RANK[worst]
        ? ISSUE_KINDS[kind].severity
        : worst,
    "ok",
  );

/** Every file the view covers, deduped — the honest denominator for totals. */
const viewFiles = (view) => {
  if (view.id === "landscape")
    return new Set([...SYSTEM_FILES.values()].flatMap((set) => [...set]));
  if (view.id.startsWith("system:")) return SYSTEM_FILES.get(view.id.slice(7)) ?? new Set();
  if (view.codeKey) return new Set(ownFiles(CODE.containers[view.codeKey]));
  if (view.id.startsWith("codefiles:")) {
    const { container, comp } = Key.parse(view.id);
    return new Set(CODE.containers[container]?.components.find((c) => c.id === comp)?.files ?? []);
  }
  return new Set();
};
const viewIssues = (view) => issuesOfFiles([...viewFiles(view)]);

/** Compact chips: "2 dead", "1 hotspot" — the label is the legend. */
const chipsFor = (counts) =>
  Object.entries(counts)
    .sort(
      (a, b) =>
        SEVERITY_RANK[ISSUE_KINDS[a[0]].severity] - SEVERITY_RANK[ISSUE_KINDS[b[0]].severity],
    )
    .map(([kind, n]) => ({
      kind,
      n,
      severity: ISSUE_KINDS[kind].severity,
      short: `${n} ${ISSUE_KINDS[kind].short}`,
      long: n === 1 ? ISSUE_KINDS[kind].label : ISSUE_KINDS[kind].label + "s",
    }));

// ── view registry ──────────────────────────────────────────────────────────

const appSystems = VM.systems.filter((s) => !s.synthetic);
const codeKeys = Object.keys(CODE.containers);

const views = [
  {
    id: "landscape",
    label: "System Landscape",
    lvl: "L1",
    title: "System Landscape — the whole estate",
  },
  ...appSystems.map((s) => ({
    id: "system:" + s.stack,
    label: s.name,
    lvl: "L2",
    parent: "landscape",
    title: `Containers — ${s.name} (${s.stack} @ ${VM.stage})`,
  })),
  ...codeKeys.map((key) => ({
    id: "code:" + key,
    label: displayName(key) + " code",
    lvl: "L3",
    parent: "system:" + key.split("/")[0],
    codeKey: key,
    title: `Modules — ${displayName(key)} (${CODE.containers[key].appRoot})`,
  })),
  {
    id: "components",
    label: "Commerce Core (hand-drawn)",
    lvl: "L3",
    parent: "system:PlatformCommerce",
    title: "Components — Commerce Core, hexagonal interior (hand-authored)",
  },
];

/** L4 views are per-module and resolved on demand rather than enumerated. */
const resolveView = (id) => {
  const found = viewById.get(id);
  if (found) return found;
  const parsed = Key.parse(id);
  if (parsed.kind === "codefiles" && CODE.containers[parsed.container]) {
    return {
      id,
      lvl: "L4",
      label: parsed.comp,
      parent: Key.codeMap(parsed.container),
      title: `Files — ${displayName(parsed.container)} / ${parsed.comp}`,
    };
  }
  return views[0]; // unknown or stale id (renamed stack in an old bookmark)
};
const viewById = new Map(views.map((v) => [v.id, v]));

const breadcrumbOf = (id) => {
  const chain = [];
  let view = resolveView(id);
  while (view) {
    chain.unshift(view);
    view = view.parent ? resolveView(view.parent) : undefined;
  }
  return chain;
};

// ── graph builders ─────────────────────────────────────────────────────────

const systemOf = (key) => {
  if (key.startsWith("actor/")) return key;
  const stack = key.split("/")[0];
  return systemByStack.has(stack) ? Key.system(stack) : key;
};

function landscapeGraph() {
  const nodes = VM.nodes
    .filter((n) => n.role === "person")
    .map((a) => ({
      key: a.key,
      name: a.name,
      role: "person",
      kindLine: "[Person]",
      desc: a.description,
      col: 0,
    }));

  for (const s of VM.systems) {
    const issues = SYSTEM_ISSUES.get(s.stack) ?? {};
    nodes.push({
      key: Key.system(s.stack),
      name: s.name,
      role: s.external || s.synthetic ? "system-ext" : "system",
      kindLine: s.external
        ? "[External system]"
        : s.synthetic
          ? "[Foundation]"
          : "[Software System]",
      desc: s.description,
      col: s.external || s.synthetic ? 2 : 1,
      chips: chipsFor(issues),
      drill: appSystems.includes(s) ? "system:" + s.stack : undefined,
    });
  }

  const byPair = new Map();
  for (const e of VM.edges) {
    const from = systemOf(e.from);
    const to = systemOf(e.to);
    if (from === to) continue;
    const id = from + "→" + to;
    if (!byPair.has(id)) byPair.set(id, { from, to, labels: [], provenance: "asserted" });
    const pair = byPair.get(id);
    if (!pair.labels.includes(e.label)) pair.labels.push(e.label);
    if (e.provenance === "extracted") pair.provenance = "extracted";
  }
  const edges = [...byPair.values()].map((p) => ({
    from: p.from,
    to: p.to,
    label:
      p.labels.slice(0, 2).join(" · ") + (p.labels.length > 2 ? ` +${p.labels.length - 2}` : ""),
    provenance: p.provenance,
  }));
  return { nodes, edges, boundary: null };
}

function systemGraph(stack) {
  const memberKeys = new Set(VM.nodes.filter((n) => n.stack === stack).map((n) => n.key));
  const touching = VM.edges.filter((e) => memberKeys.has(e.from) || memberKeys.has(e.to));
  const colOf = (n) => (n.role === "edge" ? 1 : n.role === "compute" || n.role === "dev" ? 2 : 3);

  const nodes = [...memberKeys].map((key) => {
    const n = nodeByKey.get(key);
    const issues = CONTAINER_ISSUES.get(key) ?? {};
    return {
      key,
      name: n.name,
      role: n.role,
      kindLine: containerKindLine(n),
      desc: n.description,
      domain: n.domain,
      col: colOf(n),
      member: true,
      chips: chipsFor(issues),
      drill: CODE.containers[key] ? Key.codeMap(key) : undefined,
    };
  });

  const neighbors = new Set();
  for (const e of touching) {
    if (!memberKeys.has(e.from)) neighbors.add(e.from);
    if (!memberKeys.has(e.to)) neighbors.add(e.to);
  }
  for (const key of neighbors) {
    const n = nodeByKey.get(key);
    if (!n) continue;
    const initiates = touching.some((e) => e.from === key && memberKeys.has(e.to));
    nodes.push({
      key,
      name: n.name,
      role: n.role === "person" ? "person" : "external",
      kindLine:
        n.role === "person" ? "[Person]" : `[${systemByStack.get(n.stack)?.name ?? n.stack}]`,
      compact: true,
      col: initiates ? 0 : 4,
      drill: systemByStack.has(n.stack) && n.stack !== stack ? "system:" + n.stack : undefined,
    });
  }
  return {
    nodes,
    edges: touching.map((e) => ({ ...e })),
    boundary: {
      label: `${systemByStack.get(stack).name} · ${stack} @ ${VM.stage}`,
      memberOnly: true,
    },
  };
}

function componentsGraph() {
  const colFor = { surface: 0, domain: 1, port: 2, adapter: 3 };
  return {
    nodes: VM.components.components.map((m) => ({
      key: "cmp:" + m.name,
      name: m.name,
      role: m.kind === "port" ? "edge" : m.kind === "adapter" ? "external" : "compute",
      kindLine: `[${m.kind}]`,
      desc: m.description,
      col: colFor[m.kind],
      member: true,
    })),
    edges: VM.components.wiring.map((w) => ({
      from: "cmp:" + w.from,
      to: "cmp:" + w.to,
      label: w.label,
      provenance: "asserted",
    })),
    boundary: { label: "Commerce Core — hexagonal interior (hand-authored)", memberOnly: true },
  };
}

/** Layer by import depth: importers left, dependencies right. */
const layerByDepth = (ids, edgeList, maxCol) => {
  const outs = new Map(ids.map((id) => [id, []]));
  const inDegree = new Map(ids.map((id) => [id, 0]));
  for (const e of edgeList) {
    if (!outs.has(e.from) || !outs.has(e.to)) continue;
    outs.get(e.from).push(e.to);
    inDegree.set(e.to, inDegree.get(e.to) + 1);
  }
  const depth = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => inDegree.get(id) === 0);
  const seen = new Set(queue);
  while (queue.length) {
    const cur = queue.shift();
    for (const next of outs.get(cur)) {
      depth.set(next, Math.max(depth.get(next), depth.get(cur) + 1));
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return new Map(ids.map((id) => [id, Math.min(depth.get(id), maxCol)]));
};

/** Files → the two numbers every module-ish thing reports. */
const moduleMetrics = (fileIndexes) => {
  const files = fileIndexes.map((i) => CODE.files[i]);
  return {
    fns: files.reduce((total, f) => total + f.fn_count, 0),
    cx: Math.max(0, ...files.map((f) => f.max_cyclomatic)),
  };
};

const violationPairs = (container) => {
  const pairs = new Set();
  const compOf = (filePath) =>
    container.components.find((c) => c.files.some((i) => CODE.files[i].path === filePath));
  for (const v of CODE.violations) {
    const from = compOf(v.fromPath);
    const to = compOf(v.toPath);
    if (from && to) pairs.add(`${from.id}→${to.id}`);
  }
  return pairs;
};

function codeCompGraph(key) {
  const container = CODE.containers[key];
  const cols = layerByDepth(
    container.components.map((c) => c.id),
    container.edges,
    3,
  );
  const breaches = violationPairs(container);

  const nodes = container.components.map((c) => {
    const { fns, cx } = moduleMetrics(c.files);
    return {
      key: Key.component(key, c.id),
      name: c.id,
      role: c.pkg ? "external" : "code",
      kindLine: `[${plural(c.files.length, "file")} · ${fns} fns]`,
      desc: `max complexity ${cx}`,
      col: c.entry ? 0 : Math.max(1, cols.get(c.id)),
      drill: Key.codeFiles(key, c.id),
      member: !c.pkg,
      // Imported packages are context: their problems belong to their own view,
      // and chipping them here would contradict the strip, which counts own files.
      chips: c.pkg ? [] : chipsFor(issuesOfFiles(c.files)),
    };
  });

  const edges = container.edges.map((e) => {
    const violation = breaches.has(`${e.from}→${e.to}`);
    return {
      from: `codecomp:${key}:${e.from}`,
      to: `codecomp:${key}:${e.to}`,
      label: violation ? "breaks boundary" : plural(e.n, "import") + (e.typeOnly ? " · types" : ""),
      provenance: "extracted",
      typeOnly: e.typeOnly,
      violation,
    };
  });

  return {
    nodes,
    edges,
    boundary: {
      label: `${displayName(key)} · ${container.appRoot}`,
      memberOnly: true,
    },
  };
}

function codeFileGraph(key, compId) {
  const container = CODE.containers[key];
  const comp = container?.components.find((c) => c.id === compId);
  if (!comp) return { nodes: [], edges: [], boundary: null };

  const member = new Set(comp.files);
  const compOfFile = new Map();
  for (const c of container.components) for (const i of c.files) compOfFile.set(i, c.id);

  const raw = [];
  const neighbourComps = new Set();
  for (const [from, to, flags] of CODE.edges) {
    const fromIn = member.has(from);
    const toIn = member.has(to);
    if ((!fromIn && !toIn) || !compOfFile.has(from) || !compOfFile.has(to)) continue;
    const typeOnly = (flags & 1) === 1;
    if (fromIn && toIn) raw.push({ from: Key.file(from), to: Key.file(to), typeOnly });
    else if (fromIn) {
      neighbourComps.add(compOfFile.get(to));
      raw.push({ from: Key.file(from), to: Key.component(key, compOfFile.get(to)), typeOnly });
    } else {
      neighbourComps.add(compOfFile.get(from));
      raw.push({ from: Key.component(key, compOfFile.get(from)), to: Key.file(to), typeOnly });
    }
  }

  const fileIds = [...member].map(Key.file);
  const cols = layerByDepth(
    fileIds,
    raw.filter((e) => e.from.startsWith("codefile:") && e.to.startsWith("codefile:")),
    2,
  );

  const nodes = [...member].map((i) => {
    const f = CODE.files[i];
    return {
      key: Key.file(i),
      name: basename(f.path),
      role: "code",
      kindLine: `[${f.fn_count} fns · cx ${f.max_cyclomatic}${f.is_entry ? " · entry" : ""}]`,
      desc: `${f.importer_count} importers`,
      col: 1 + cols.get(`codefile:${i}`),
      member: true,
      chips: chipsFor(FILE_ISSUES[i]),
    };
  });
  for (const compName of neighbourComps) {
    nodes.push({
      key: Key.component(key, compName),
      name: compName,
      role: "external",
      kindLine: "[module]",
      compact: true,
      col: raw.some((e) => e.from === Key.component(key, compName)) ? 0 : 4,
      drill: Key.codeFiles(key, compName),
    });
  }

  const edges = [...new Map(raw.map((e) => [`${e.from}→${e.to}`, e])).values()].map((e) => ({
    ...e,
    label: e.typeOnly ? "types" : "imports",
    provenance: "extracted",
  }));
  return {
    nodes,
    edges,
    boundary: { label: `${displayName(key)} / ${compId}`, memberOnly: true },
  };
}

function containerKindLine(n) {
  const kind =
    n.role === "datastore"
      ? "Data"
      : n.role === "edge"
        ? "Infrastructure"
        : n.role === "schema"
          ? "Build-time"
          : n.role === "dev"
            ? "Dev only"
            : "Container";
  return `[${kind}: ${n.technology || n.type || ""}]`;
}

const graphFor = (id) => {
  if (id === "landscape") return landscapeGraph();
  if (id === "components") return componentsGraph();
  const parsed = Key.parse(id);
  const known = CODE.containers[parsed.container];
  if (parsed.kind === "code" && known) return codeCompGraph(parsed.container);
  if (parsed.kind === "codefiles" && known) return codeFileGraph(parsed.container, parsed.comp);
  if (parsed.kind === "system" && systemByStack.has(parsed.stack)) return systemGraph(parsed.stack);
  return landscapeGraph(); // stale id (a renamed stack in an old bookmark)
};

// ── layout ─────────────────────────────────────────────────────────────────

const SIZES = {
  person: { w: 182, h: 80 },
  system: { w: 228, h: 118 },
  card: { w: 210, h: 100 },
  compact: { w: 168, h: 46 },
};
const sizeOf = (n) =>
  n.compact
    ? SIZES.compact
    : n.role === "person"
      ? SIZES.person
      : n.role.startsWith("system")
        ? SIZES.system
        : SIZES.card;

function layout(graph) {
  const COL_W = 318;
  const ROW_GAP = 34;
  const cols = new Map();
  for (const n of graph.nodes) {
    if (!cols.has(n.col)) cols.set(n.col, []);
    cols.get(n.col).push(n);
  }

  // Longest-path depth saturates on a dense mesh — every module ends up at the
  // same depth and the column becomes an unreadable stack. Spill any oversized
  // column across fractional lanes; ordering is by value, so they slot in after
  // their parent column and before the next one.
  const MAX_PER_COL = 7;
  for (const [col, members] of [...cols]) {
    if (members.length <= MAX_PER_COL) continue;
    const lanes = Math.ceil(members.length / MAX_PER_COL);
    const perLane = Math.ceil(members.length / lanes);
    cols.set(col, members.slice(0, perLane));
    for (let lane = 1; lane < lanes; lane++) {
      const slice = members.slice(lane * perLane, (lane + 1) * perLane);
      if (slice.length) {
        cols.set(col + lane / (lanes + 1), slice);
        for (const n of slice) n.col = col + lane / (lanes + 1);
      }
    }
  }
  const colIndexes = [...cols.keys()].sort((a, b) => a - b);

  // Two barycenter passes: order each column by the mean position of its
  // neighbours, which is most of what keeps edges from crossing.
  const pos = new Map(graph.nodes.map((n, i) => [n.key, i]));
  const neighbours = new Map(graph.nodes.map((n) => [n.key, []]));
  for (const e of graph.edges) {
    neighbours.get(e.from)?.push(e.to);
    neighbours.get(e.to)?.push(e.from);
  }
  const meanOf = (n) => {
    const ns = neighbours
      .get(n.key)
      .map((k) => pos.get(k))
      .filter((v) => v !== undefined);
    return ns.length ? ns.reduce((sum, v) => sum + v, 0) / ns.length : pos.get(n.key);
  };
  for (const pass of [0, 1]) {
    for (const ci of pass === 0 ? colIndexes : [...colIndexes].reverse()) {
      // Means are computed once per column, not once per comparison.
      const means = new Map(cols.get(ci).map((n) => [n.key, meanOf(n)]));
      cols.get(ci).sort((a, b) => means.get(a.key) - means.get(b.key));
      cols.get(ci).forEach((n, i) => pos.set(n.key, i));
    }
  }

  const colHeight = (ci) => cols.get(ci).reduce((s, n) => s + sizeOf(n).h + ROW_GAP, -ROW_GAP);
  const maxH = Math.max(...colIndexes.map(colHeight));
  const placed = new Map();
  colIndexes.forEach((ci, i) => {
    let y = (maxH - colHeight(ci)) / 2;
    for (const n of cols.get(ci)) {
      const s = sizeOf(n);
      placed.set(n.key, {
        ...n,
        x: 40 + i * COL_W + (COL_W - 40 - s.w) / 2,
        y: 40 + y,
        w: s.w,
        h: s.h,
      });
      y += s.h + ROW_GAP;
    }
  });
  return { placed, width: 40 + colIndexes.length * COL_W + 40, height: maxH + 120 };
}

// ── render ─────────────────────────────────────────────────────────────────

const app = document.getElementById("app");
let currentView = "landscape";
let selectedKey = null;
let searchOpen = false;
let viewBox = { x: 0, y: 0, w: 1200, h: 800 };
let svg;
let contentBounds = { width: 1200, height: 800 };
let fittedView = null; // the view the current viewBox was fitted to
// Cached per render so hover never re-queries the DOM.
let edgeEls = [];
let nodeEls = [];
let adjacency = new Map();

const navigate = (id, select = null) => {
  currentView = id;
  selectedKey = select;
  searchOpen = false;
  render();
};
const closeSearch = () => {
  searchOpen = false;
  render();
};

function render() {
  app.textContent = "";
  const view = resolveView(currentView);
  const graph = graphFor(currentView);
  app.append(topbar(view), rail(view), canvas(graph, view), inspector());
  if (searchOpen) app.append(searchOverlay());

  const params = new URLSearchParams({ view: currentView });
  if (selectedKey) params.set("select", selectedKey);
  history.replaceState(null, "", "#" + params.toString());
}

function topbar(view) {
  const crumbs = el("nav", { class: "crumbs", "aria-label": "breadcrumb" });
  breadcrumbOf(view.id).forEach((step, i, all) => {
    if (i > 0) crumbs.append(el("span", { class: "sep", text: "›" }));
    crumbs.append(
      i === all.length - 1
        ? el(
            "span",
            { class: "crumb here" },
            el("span", { class: "lvl", text: step.lvl }),
            document.createTextNode(step.label),
          )
        : el(
            "button",
            { class: "crumb", onclick: () => navigate(step.id) },
            el("span", { class: "lvl", text: step.lvl }),
            document.createTextNode(step.label),
          ),
    );
  });

  return el(
    "header",
    { class: "topbar" },
    el("h1", { text: "somewhatintelligent" }),
    crumbs,
    el("span", { class: "spacer" }),
    el(
      "button",
      {
        class: "ghost",
        onclick: () => {
          searchOpen = true;
          render();
        },
        title: "Search (/)",
      },
      document.createTextNode("Search"),
      el("kbd", { text: "/" }),
    ),
    el("span", { class: "badge stage", text: VM.stage }),
  );
}

/** The strip that answers "what should I worry about here?" before any click. */
function statStrip(graph, view) {
  // Counted from the view's deduped file set, never by summing node chips —
  // containers within a system share files, so chip sums over-count.
  const issues = viewIssues(view);
  const strip = el("div", { class: "stats" });

  const facts = [];
  if (view.id === "landscape") {
    facts.push(
      [appSystems.length, "systems"],
      [VM.nodes.filter((n) => n.role === "person").length, "actors"],
      [VM.edges.length, "relationships"],
    );
  } else if (view.id.startsWith("system:")) {
    const members = graph.nodes.filter((n) => n.member);
    facts.push(
      [members.filter((n) => n.role === "compute").length, "applications"],
      [members.filter((n) => n.role === "datastore").length, "data stores"],
      [members.filter((n) => n.domain).length, "public surfaces"],
    );
  } else if (view.id.startsWith("code:")) {
    const container = CODE.containers[view.codeKey];
    const own = container.components.filter((c) => !c.pkg);
    facts.push(
      [own.length, "modules"],
      [own.reduce((s, c) => s + c.files.length, 0), "files"],
      [
        own.reduce((s, c) => s + c.files.reduce((t, i) => t + CODE.files[i].fn_count, 0), 0),
        "functions",
      ],
    );
  } else if (view.id.startsWith("codefiles:")) {
    const files = graph.nodes
      .filter((n) => n.member)
      .map((n) => CODE.files[Number(n.key.slice(9))]);
    facts.push(
      [files.length, "files"],
      [files.reduce((s, f) => s + f.fn_count, 0), "functions"],
      [Math.max(0, ...files.map((f) => f.max_cyclomatic)), "peak complexity"],
    );
  }
  for (const [value, label] of facts) {
    strip.append(
      el(
        "span",
        { class: "stat" },
        el("b", { text: String(value) }),
        document.createTextNode(label),
      ),
    );
  }

  const chips = chipsFor(issues);
  strip.append(el("span", { class: "spacer" }));
  if (chips.length === 0) {
    strip.append(el("span", { class: "stat clear", text: "no issues in this view" }));
  } else {
    for (const chip of chips) {
      strip.append(
        el(
          "button",
          {
            class: `chip ${chip.severity}`,
            title: `Highlight ${chip.long}`,
            onclick: () => highlightIssue(chip.kind),
          },
          el("b", { text: String(chip.n) }),
          document.createTextNode(chip.long),
        ),
      );
    }
  }
  return strip;
}

function rail(view) {
  const chain = new Set(breadcrumbOf(view.id).map((v) => v.id));

  const link = (v, extra = "") => {
    const issues =
      v.id === "landscape"
        ? {}
        : v.id.startsWith("system:")
          ? (SYSTEM_ISSUES.get(v.id.slice(7)) ?? {})
          : v.codeKey
            ? (CONTAINER_ISSUES.get(v.codeKey) ?? {})
            : {};
    const severity = worstSeverity(issues);
    return el(
      "button",
      {
        class: `viewlink ${extra} ${v.id === view.id ? "active" : chain.has(v.id) ? "ancestor" : ""}`,
        onclick: () => navigate(v.id),
      },
      el("span", { class: "lvl", text: v.lvl }),
      document.createTextNode(v.label),
      severity !== "ok"
        ? el("span", { class: `dot ${severity}`, title: `${totalIssues(issues)} issues` })
        : null,
    );
  };

  const nav = el("nav", {});
  nav.append(link(views[0]));
  for (const system of appSystems) {
    const systemView = views.find((v) => v.id === "system:" + system.stack);
    nav.append(link(systemView));
    if (!chain.has(systemView.id)) continue;
    // Expand the open system into its code maps, and the open map into its
    // modules — the rail mirrors exactly how deep you are.
    for (const v of views.filter((c) => c.parent === systemView.id)) {
      nav.append(link(v, "sub"));
      if (!v.codeKey || !chain.has(v.id)) continue;
      for (const comp of CODE.containers[v.codeKey].components.filter((c) => !c.pkg)) {
        const id = `codefiles:${v.codeKey}:${comp.id}`;
        const severity = worstSeverity(issuesOfFiles(comp.files));
        nav.append(
          el(
            "button",
            {
              class: `viewlink sub2 ${currentView === id ? "active" : ""}`,
              onclick: () => navigate(id),
            },
            el("span", { class: "lvl", text: "L4" }),
            document.createTextNode(comp.id),
            severity !== "ok" ? el("span", { class: `dot ${severity}` }) : null,
          ),
        );
      }
    }
  }

  return el(
    "aside",
    { class: "rail" },
    el("h2", { text: "Zoom" }),
    nav,
    el(
      "footer",
      {},
      el("div", { class: "src", text: `code graph · ${CODE_SOURCE}` }),
      CODE.deadCodeSource
        ? el("div", { class: "src", text: `dead code · ${CODE.deadCodeSource.split(" (")[0]}` })
        : null,
      el("button", { class: "ghost", onclick: toggleLegend, text: "Legend" }),
    ),
  );
}

function canvas(graph, view) {
  const { placed, width, height } = layout(graph);
  contentBounds = { width, height };
  const dense = graph.edges.length > 14;

  adjacency = new Map();
  for (const e of graph.edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, new Set());
    if (!adjacency.has(e.to)) adjacency.set(e.to, new Set());
    adjacency.get(e.from).add(e.to);
    adjacency.get(e.to).add(e.from);
  }

  svg = svgEl("svg", { role: "img", "aria-label": view.title });
  svg.append(
    svgEl(
      "defs",
      {},
      marker("arr", "var(--ink-soft)"),
      marker("arr-hot", "var(--accent)"),
      marker("arr-bad", "var(--critical)"),
    ),
  );
  const root = svgEl("g", {});
  svg.append(root);

  if (graph.boundary) {
    const members = [...placed.values()].filter((n) => !graph.boundary.memberOnly || n.member);
    if (members.length) {
      const minX = Math.min(...members.map((n) => n.x)) - 24;
      const minY = Math.min(...members.map((n) => n.y)) - 32;
      root.append(
        svgEl("rect", {
          class: "boundary",
          x: minX,
          y: minY,
          width: Math.max(...members.map((n) => n.x + n.w)) + 24 - minX,
          height: Math.max(...members.map((n) => n.y + n.h)) + 24 - minY,
          rx: 14,
        }),
        svgEl(
          "text",
          { class: "boundary-label", x: minX + 14, y: minY - 9 },
          document.createTextNode(graph.boundary.label),
        ),
      );
    }
  }

  root.append(edgeLayer(graph, placed, dense));
  nodeEls = [...placed.values()].map((n) => {
    const element = nodeEl(n);
    root.append(element);
    return { key: n.key, element };
  });

  // Re-fit only when the view changes; otherwise selecting a node would throw
  // away the pan and zoom the reader just set up.
  if (fittedView !== view.id) {
    fittedView = view.id;
    fitView();
  } else {
    applyViewBox();
  }
  attachPanZoom();

  return el(
    "main",
    { class: "canvas-wrap" },
    statStrip(graph, view),
    svg,
    el(
      "div",
      { class: "zoombar" },
      el("button", { text: "+", "aria-label": "zoom in", onclick: () => zoom(0.8) }),
      el("button", { text: "–", "aria-label": "zoom out", onclick: () => zoom(1.25) }),
      el("button", { text: "Fit", "aria-label": "fit to view", onclick: fitView }),
    ),
    el("div", {
      class: "canvas-hint",
      text: dense
        ? "hover a node for its relationships · drag to pan"
        : "drag to pan · wheel to zoom",
    }),
  );
}

function marker(id, color) {
  return svgEl(
    "marker",
    {
      id,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto-start-reverse",
    },
    svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }),
  );
}

/**
 * Edges attach along each node's side, fanned by the far endpoint's y, so a
 * hub like a shared database doesn't collapse every arrow onto one point.
 */
function edgeLayer(graph, placed, dense) {
  const layer = svgEl("g", { class: dense ? "edges quiet" : "edges" });
  const descs = [];
  for (const e of graph.edges) {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    if (!a || !b) continue;
    const same = Math.abs(a.x - b.x) < 10;
    const ltr = a.x + a.w / 2 < b.x + b.w / 2;
    const loopLeft = same && a.col === 2;
    descs.push({
      e,
      a,
      b,
      same,
      loopLeft,
      srcSide: same ? (loopLeft ? "L" : "R") : ltr ? "R" : "L",
      tgtSide: same ? (loopLeft ? "L" : "R") : ltr ? "L" : "R",
    });
  }

  const attach = new Map();
  for (const d of descs) {
    for (const [node, side, entry] of [
      [d.a, d.srcSide, { d, isSrc: true, otherY: d.b.y + d.b.h / 2 }],
      [d.b, d.tgtSide, { d, isSrc: false, otherY: d.a.y + d.a.h / 2 }],
    ]) {
      const k = node.key + ":" + side;
      if (!attach.has(k)) attach.set(k, { node, list: [] });
      attach.get(k).list.push(entry);
    }
  }
  for (const { node, list } of attach.values()) {
    list.sort((p, q) => p.otherY - q.otherY);
    list.forEach((p, i) => {
      const y = node.y + node.h * (list.length === 1 ? 0.5 : 0.2 + (0.6 * i) / (list.length - 1));
      if (p.isSrc) p.d.srcY = y;
      else p.d.tgtY = y;
    });
  }

  let loopNth = 0;
  edgeEls = descs.map((d) => {
    const element = edgeEl(d, d.same ? loopNth++ : 0);
    layer.append(element);
    return {
      element,
      path: element.querySelector("path"),
      from: d.e.from,
      to: d.e.to,
      violation: d.e.violation,
    };
  });
  return layer;
}

const pointOnCubic = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
};

function edgeEl(d, loopNth) {
  const { e, a, b } = d;
  const g = svgEl("g", {
    class: `edge ${e.provenance}${e.violation ? " violation" : ""}${e.typeOnly ? " typeonly" : ""}`,
    "data-from": e.from,
    "data-to": e.to,
  });
  const y1 = d.srcY ?? a.y + a.h / 2;
  const y2 = d.tgtY ?? b.y + b.h / 2;
  const marker = e.violation ? "url(#arr-bad)" : "url(#arr)";

  if (d.same) {
    const left = d.loopLeft;
    const sx = left ? a.x : a.x + a.w;
    const tx = left ? b.x : b.x + b.w;
    const bulge = (34 + loopNth * 16) * (left ? -1 : 1);
    const p0 = { x: sx, y: y1 };
    const p1 = { x: sx + bulge, y: y1 };
    const p2 = { x: tx + bulge, y: y2 };
    const p3 = { x: tx + (left ? -3 : 3), y: y2 };
    const at = pointOnCubic(p0, p1, p2, p3, 0.5);
    g.append(
      svgEl("path", {
        d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`,
        "marker-end": marker,
      }),
      edgeLabel(at.x + bulge * 0.4, at.y, e.label, left ? "end" : "start"),
    );
    return g;
  }

  const ltr = d.srcSide === "R";
  const p0 = { x: ltr ? a.x + a.w : a.x, y: y1 };
  const p3 = { x: ltr ? b.x : b.x + b.w, y: y2 };
  const dx = (p3.x - p0.x) / 2;
  const p1 = { x: p0.x + dx, y: p0.y };
  const p2 = { x: p3.x - dx, y: p3.y };
  const at = pointOnCubic(p0, p1, p2, p3, 0.32);
  g.append(
    svgEl("path", {
      d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`,
      "marker-end": marker,
    }),
    edgeLabel(at.x, at.y - 6, e.label, "middle"),
  );
  return g;
}

function edgeLabel(x, y, text, anchor) {
  const t = svgEl("text", { x, y, "text-anchor": anchor });
  t.textContent = text;
  return t;
}

function nodeEl(n) {
  const severity = n.chips?.length
    ? worstSeverity(Object.fromEntries(n.chips.map((c) => [c.kind, c.n])))
    : null;
  const g = svgEl("g", {
    class: `node role-${n.role}${n.key === selectedKey ? " selected" : ""}${severity ? " sev-" + severity : ""}`,
    tabindex: 0,
    role: "button",
    "aria-label": `${n.name}${severity ? `, ${n.chips.map((c) => c.long).join(", ")}` : ""}`,
    "data-key": n.key,
    "data-issues": n.chips?.map((c) => c.kind).join(" "),
  });
  g.append(
    svgEl("rect", {
      class: "box",
      x: n.x,
      y: n.y,
      width: n.w,
      height: n.h,
      rx: n.role === "person" ? 20 : 8,
    }),
  );
  if (severity) g.append(svgEl("rect", { class: "sevbar", x: n.x, y: n.y, width: 4, height: n.h }));

  const cx = n.x + n.w / 2;
  let ty = n.y + 22;
  g.append(
    svgEl(
      "text",
      { class: "name", x: cx, y: ty, "text-anchor": "middle" },
      document.createTextNode(n.name),
    ),
  );
  ty += 14;
  if (n.kindLine) {
    g.append(
      svgEl(
        "text",
        { class: "kind", x: cx, y: ty, "text-anchor": "middle" },
        document.createTextNode(n.kindLine),
      ),
    );
    ty += 14;
  }
  if (!n.compact && n.desc) {
    for (const line of wrap(
      n.desc,
      Math.floor((n.w - 24) / 5.4),
      n.role.startsWith("system") ? 3 : 2,
    )) {
      g.append(
        svgEl(
          "text",
          { class: "desc", x: cx, y: ty, "text-anchor": "middle" },
          document.createTextNode(line),
        ),
      );
      ty += 12;
    }
  }
  if (n.domain) {
    g.append(
      svgEl(
        "text",
        { class: "domain", x: cx, y: n.y + n.h - 22, "text-anchor": "middle" },
        document.createTextNode(n.domain),
      ),
    );
  }

  // Issue chips sit on the bottom edge: readable at a glance, no click needed.
  if (n.chips?.length) {
    let x = n.x + 10;
    for (const chip of n.chips.slice(0, 3)) {
      const w = chip.short.length * 5.6 + 12;
      g.append(
        svgEl("rect", {
          class: `chip ${chip.severity}`,
          x,
          y: n.y + n.h - 17,
          width: w,
          height: 14,
          rx: 7,
        }),
        svgEl(
          "text",
          {
            class: `chiptext ${chip.severity}`,
            x: x + w / 2,
            y: n.y + n.h - 7,
            "text-anchor": "middle",
          },
          document.createTextNode(chip.short),
        ),
      );
      x += w + 5;
    }
  }
  if (n.drill) {
    g.append(
      svgEl(
        "text",
        { class: "drill", x: n.x + n.w - 11, y: n.y + 17, "text-anchor": "middle" },
        document.createTextNode("›"),
      ),
    );
  }

  const open = () => {
    selectedKey = n.key;
    render();
  };
  g.addEventListener("click", (ev) => {
    ev.stopPropagation();
    open();
  });
  g.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      open();
    } else if (ev.key === "ArrowRight" && n.drill) navigate(n.drill);
  });
  if (n.drill) {
    g.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      navigate(n.drill);
    });
  }
  g.addEventListener("mouseenter", () => focusNode(n.key, true));
  g.addEventListener("mouseleave", () => focusNode(n.key, false));
  return g;
}

/** Hover isolation: the node's own relationships light up, everything else fades. */
function focusNode(key, on) {
  for (const edge of edgeEls) {
    const touches = edge.from === key || edge.to === key;
    edge.element.classList.toggle("hot", on && touches);
    edge.element.classList.toggle("dim", on && !touches);
    if (!edge.violation) {
      edge.path.setAttribute("marker-end", on && touches ? "url(#arr-hot)" : "url(#arr)");
    }
  }
  const connected = adjacency.get(key) ?? new Set();
  for (const node of nodeEls) {
    node.element.classList.toggle("dim", on && node.key !== key && !connected.has(node.key));
  }
}

/** Clicking a stat chip pins every node carrying that issue. */
function highlightIssue(kind) {
  const clearing = svg.dataset.issue === kind;
  svg.dataset.issue = clearing ? "" : kind;
  for (const node of nodeEls) {
    const carries = node.element.dataset.issues?.split(" ").includes(kind);
    node.element.classList.toggle("dim", !clearing && !carries);
  }
}

// ── inspector ──────────────────────────────────────────────────────────────

function inspector() {
  const panel = el("aside", { class: "inspector" + (selectedKey ? " open" : "") });
  if (!selectedKey) return panel;
  panel.append(
    selectedKey.startsWith("codecomp:") || selectedKey.startsWith("codefile:")
      ? codePanel(selectedKey)
      : topologyPanel(selectedKey),
  );
  return panel;
}

const closeButton = () =>
  el("button", {
    class: "close",
    text: "✕",
    "aria-label": "close details",
    onclick: () => {
      selectedKey = null;
      render();
    },
  });

const definitionList = (rows) => {
  const dl = el("dl", {});
  for (const [key, value] of rows) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    dl.append(el("dt", { text: key }), el("dd", { text: String(value) }));
  }
  return dl.children.length ? dl : null;
};

const issueList = (counts) => {
  const chips = chipsFor(counts);
  if (!chips.length) return null;
  const box = el("div", { class: "issues" });
  for (const chip of chips)
    box.append(
      el(
        "span",
        { class: `chip ${chip.severity}` },
        el("b", { text: String(chip.n) }),
        document.createTextNode(chip.long),
      ),
    );
  return box;
};

function topologyPanel(key) {
  const inner = el("div", { class: "inner" });
  const node = nodeByKey.get(key);
  const system = key.startsWith("sys:") ? systemByStack.get(key.slice(4)) : null;
  const component = key.startsWith("cmp:")
    ? VM.components.components.find((c) => "cmp:" + c.name === key)
    : null;

  inner.append(
    closeButton(),
    el("h3", { text: system?.name ?? component?.name ?? node?.name ?? key }),
    el("div", {
      class: "meta",
      text: system
        ? "software system"
        : component
          ? `component · ${component.kind}`
          : (node?.type ?? node?.technology ?? ""),
    }),
    el("p", {
      class: "desc",
      text: system?.description ?? component?.description ?? node?.description ?? "",
    }),
  );

  const issues = system ? SYSTEM_ISSUES.get(system.stack) : CONTAINER_ISSUES.get(key);
  if (issues)
    inner.append(issueList(issues) ?? el("div", { class: "clear", text: "no code issues" }));

  if (node) {
    inner.append(
      definitionList([
        ["stack", node.stack],
        ["id", node.fqn],
        ["type", node.type],
        ["domain", node.domain],
        ["service", node.serviceName],
        ["exported", node.exported ? "part of the stack's output contract" : undefined],
        ["source", node.extracted ? "alchemy stack eval" : "overlay model"],
      ]),
    );
  }

  const drill =
    system && appSystems.includes(system)
      ? "system:" + system.stack
      : CODE.containers[key]
        ? "code:" + key
        : null;
  if (drill)
    inner.append(
      el("button", {
        class: "drillbtn",
        text: `Open ${resolveView(drill).lvl} · ${resolveView(drill).label} →`,
        onclick: () => navigate(drill),
      }),
    );

  const relate = (list, dir) => {
    const ul = el("ul", { class: "rels" });
    for (const e of list) {
      const otherKey = dir === "out" ? e.to : e.from;
      ul.append(
        el(
          "li",
          { class: e.provenance },
          el("div", {
            class: "who",
            text: (dir === "out" ? "→ " : "← ") + displayName(otherKey),
          }),
          el("div", {
            class: "lbl",
            text: [e.label, e.technology, e.detail].filter(Boolean).join(" · "),
          }),
        ),
      );
    }
    return ul;
  };
  const outs = VM.edges.filter((e) => e.from === key);
  const ins = VM.edges.filter((e) => e.to === key);
  if (outs.length) inner.append(el("h4", { text: "uses" }), relate(outs, "out"));
  if (ins.length) inner.append(el("h4", { text: "used by" }), relate(ins, "in"));

  if (node?.extracted && node.props) {
    inner.append(
      el("h4", { text: "extracted props" }),
      el("pre", { text: JSON.stringify(node.props, null, 2) }),
    );
  }
  return inner;
}

function codePanel(key) {
  const inner = el("div", { class: "inner" });

  if (key.startsWith("codecomp:")) {
    const [, containerKey, ...rest] = key.split(":");
    const compId = rest.join(":");
    const container = CODE.containers[containerKey];
    const comp = container?.components.find((c) => c.id === compId);
    if (!comp) return inner;
    const files = comp.files.map((i) => CODE.files[i]);

    inner.append(
      closeButton(),
      el("h3", { text: compId }),
      el("div", { class: "meta", text: `module · ${container.appRoot}` }),
      issueList(issuesOfFiles(comp.files)) ?? el("div", { class: "clear", text: "no issues" }),
      definitionList([
        ["files", files.length],
        ["functions", files.reduce((s, f) => s + f.fn_count, 0)],
        ["peak complexity", Math.max(0, ...files.map((f) => f.max_cyclomatic))],
      ]),
      el("button", {
        class: "drillbtn",
        text: "Open L4 · files →",
        onclick: () => navigate(`codefiles:${containerKey}:${compId}`),
      }),
      el("h4", { text: "files" }),
    );

    const ul = el("ul", { class: "rels" });
    for (const i of comp.files
      .slice()
      .sort((a, b) => CODE.files[b].max_cyclomatic - CODE.files[a].max_cyclomatic)) {
      const f = CODE.files[i];
      ul.append(
        el(
          "li",
          { class: worstSeverity(FILE_ISSUES[i]) },
          el("div", { class: "who", text: basename(f.path) + (f.is_entry ? " · entry" : "") }),
          el("div", {
            class: "lbl",
            text: `${f.fn_count} fns · cx ${f.max_cyclomatic} · ${(f.size / 1024).toFixed(1)} KiB`,
          }),
        ),
      );
    }
    inner.append(ul);
    return inner;
  }

  const f = CODE.files[Number(key.slice("codefile:".length))];
  if (!f) return inner;
  const idx = Number(key.slice("codefile:".length));

  inner.append(
    closeButton(),
    el("h3", { text: basename(f.path) }),
    el("div", { class: "meta path", text: f.path }),
    issueList(FILE_ISSUES[idx]) ?? el("div", { class: "clear", text: "no issues" }),
    definitionList([
      ["size", `${(f.size / 1024).toFixed(1)} KiB`],
      ["exports", f.export_count],
      ["importers", f.importer_count],
      ["imports", f.import_count],
      ["entry point", f.is_entry ? "yes" : undefined],
      ["dead exports", f.unused_exports?.length ? f.unused_exports.join(", ") : undefined],
      ["structure", `${CODE_SOURCE} · oxc AST`],
      ["dead code", CODE.deadCodeSource],
    ]),
  );

  if (f.functions?.length) {
    inner.append(el("h4", { text: `functions (${f.functions.length})` }));
    const ul = el("ul", { class: "rels" });
    for (const fn of f.functions) {
      ul.append(
        el(
          "li",
          {
            class:
              fn.cyclomatic >= HOTSPOT_AT ? "critical" : fn.cyclomatic >= COMPLEX_AT ? "warn" : "",
          },
          el("div", { class: "who", text: `${fn.name}()` }),
          el("div", {
            class: "lbl",
            text: `line ${fn.line} · cx ${fn.cyclomatic} · cognitive ${fn.cognitive} · ${fn.lines} lines`,
          }),
        ),
      );
    }
    inner.append(ul);
  }
  return inner;
}

// ── search ─────────────────────────────────────────────────────────────────

/** Everything addressable, flattened once: systems, containers, modules, files. */
const searchIndex = (() => {
  const entries = [
    ...VM.nodes
      .filter((n) => n.role !== "person" && n.extracted !== false)
      .map((n) => ({
        label: n.name,
        hint: `${n.type ?? ""} · ${n.stack}`,
        view: CODE.containers[n.key] ? "code:" + n.key : "system:" + n.stack,
        select: n.key,
        lvl: "L2",
      })),
    ...VM.systems
      .filter((s) => !s.synthetic)
      .map((s) => ({
        label: s.name,
        hint: "software system",
        view: "system:" + s.stack,
        select: "sys:" + s.stack,
        lvl: "L1",
      })),
  ];
  for (const [key, container] of Object.entries(CODE.containers)) {
    for (const comp of container.components.filter((c) => !c.pkg)) {
      entries.push({
        label: comp.id,
        hint: `module · ${container.appRoot}`,
        view: `codefiles:${key}:${comp.id}`,
        lvl: "L3",
      });
      for (const i of comp.files) {
        entries.push({
          label: basename(CODE.files[i].path),
          hint: CODE.files[i].path,
          view: `codefiles:${key}:${comp.id}`,
          select: `codefile:${i}`,
          lvl: "L4",
          issues: totalIssues(FILE_ISSUES[i]),
        });
      }
    }
  }
  // A file reachable from several containers appears once: its identity is the
  // thing itself, not the route that reaches it.
  return [...new Map(entries.map((e) => [e.select ?? `${e.view}|${e.label}`, e])).values()].map(
    (e) => ({
      ...e,
      lvl: resolveView(e.view).lvl, // the badge must name where the click lands
      haystack: `${e.label} ${e.hint}`.toLowerCase(),
    }),
  );
})();

function searchOverlay() {
  const results = el("ul", { class: "results" });
  const input = el("input", {
    type: "search",
    placeholder: "Find a system, container, module or file…",
    "aria-label": "Search",
    autofocus: "true",
  });

  const run = () => {
    const query = input.value.trim().toLowerCase();
    results.textContent = "";
    const matches = (
      query
        ? searchIndex.filter((e) => e.haystack.includes(query))
        : searchIndex.filter((e) => e.issues)
    )
      .sort((a, b) => (b.issues ?? 0) - (a.issues ?? 0) || a.label.length - b.label.length)
      .slice(0, 40);
    if (!matches.length) {
      results.append(
        el("li", {
          class: "empty",
          text: query ? "nothing matches" : "no issues anywhere — search to explore",
        }),
      );
      return;
    }
    for (const m of matches) {
      results.append(
        el(
          "li",
          {},
          el(
            "button",
            { onclick: () => navigate(m.view, m.select) },
            el("span", { class: "lvl", text: m.lvl }),
            el("span", { class: "label", text: m.label }),
            el("span", { class: "hint", text: m.hint }),
            m.issues ? el("span", { class: "dot warn" }) : null,
          ),
        ),
      );
    }
  };

  input.addEventListener("input", run);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeSearch();
    else if (ev.key === "Enter") results.querySelector("button")?.click();
  });

  const overlay = el(
    "div",
    {
      class: "overlay",
      onclick: (ev) => {
        if (ev.target === overlay) closeSearch();
      },
    },
    el("div", { class: "searchbox" }, input, results),
  );
  run();
  queueMicrotask(() => input.focus());
  return overlay;
}

function toggleLegend() {
  const existing = document.querySelector(".legend-pop");
  if (existing) return existing.remove();
  const row = (swatch, text) => el("div", { class: "k" }, swatch, document.createTextNode(text));
  const dash = (cls) => el("span", { class: `stroke ${cls}` });
  document.body.append(
    el(
      "div",
      { class: "legend-pop" },
      el("h4", { text: "Elements" }),
      row(el("span", { class: "sw compute" }), "application (runs code)"),
      row(el("span", { class: "sw datastore" }), "data store, queue"),
      row(el("span", { class: "sw edge" }), "access, wiring"),
      row(el("span", { class: "sw external" }), "external / other system"),
      row(el("span", { class: "sw person" }), "person or agent"),
      el("h4", { text: "Relationships" }),
      row(dash(""), "extracted — IaC or import graph"),
      row(dash("dashed"), "asserted — cited in code"),
      row(dash("dotted"), "type-only import"),
      row(dash("bad"), "boundary violation"),
      el("h4", { text: "Issues" }),
      row(el("span", { class: "sw crit" }), `critical — cycles, breaches, cx ≥ ${HOTSPOT_AT}`),
      row(el("span", { class: "sw warn" }), `warning — dead exports, cx ≥ ${COMPLEX_AT}`),
      el("p", { text: "Arrows read “A → uses → B”. › means the node opens a deeper view." }),
      el("button", {
        class: "ghost",
        text: "Close",
        onclick: () => document.querySelector(".legend-pop").remove(),
      }),
    ),
  );
}

// ── pan & zoom ─────────────────────────────────────────────────────────────

function fitView() {
  viewBox = { x: -20, y: -20, w: contentBounds.width + 40, h: contentBounds.height + 40 };
  applyViewBox();
}
let viewBoxFrame = 0;
function applyViewBox() {
  if (viewBoxFrame) return; // pointermove fires far faster than we can paint
  viewBoxFrame = requestAnimationFrame(() => {
    viewBoxFrame = 0;
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
  });
}
function zoom(factor, cx, cy) {
  const px = cx ?? viewBox.x + viewBox.w / 2;
  const py = cy ?? viewBox.y + viewBox.h / 2;
  viewBox = {
    x: px - (px - viewBox.x) * factor,
    y: py - (py - viewBox.y) * factor,
    w: viewBox.w * factor,
    h: viewBox.h * factor,
  };
  applyViewBox();
}
function attachPanZoom() {
  let panning = null;
  svg.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".node")) return;
    panning = { x: ev.clientX, y: ev.clientY, vb: { ...viewBox } };
    svg.classList.add("panning");
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!panning) return;
    const scale = viewBox.w / svg.clientWidth;
    viewBox.x = panning.vb.x - (ev.clientX - panning.x) * scale;
    viewBox.y = panning.vb.y - (ev.clientY - panning.y) * scale;
    applyViewBox();
  });
  const stop = () => {
    panning = null;
    svg.classList.remove("panning");
  };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);
  svg.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoom(
        ev.deltaY > 0 ? 1.12 : 0.89,
        viewBox.x + ((ev.clientX - rect.left) / rect.width) * viewBox.w,
        viewBox.y + ((ev.clientY - rect.top) / rect.height) * viewBox.h,
      );
    },
    { passive: false },
  );
  svg.addEventListener("click", (ev) => {
    if (ev.target.closest(".node")) return;
    if (svg.dataset.issue) return highlightIssue(svg.dataset.issue);
    if (selectedKey) {
      selectedKey = null;
      render();
    }
  });
}

// ── boot ───────────────────────────────────────────────────────────────────

document.addEventListener("keydown", (ev) => {
  if (ev.target instanceof HTMLInputElement) return;
  if (ev.key === "/") {
    ev.preventDefault();
    searchOpen = true;
    render();
  } else if (ev.key === "Escape") {
    if (selectedKey || searchOpen) {
      selectedKey = null;
      searchOpen = false;
      render();
    }
  } else if (ev.key === "Backspace") {
    const parent = resolveView(currentView).parent;
    if (parent) navigate(parent);
  }
});

const boot = new URLSearchParams(location.hash.slice(1));
if (boot.get("view")) currentView = boot.get("view");
if (boot.get("select")) selectedKey = boot.get("select");
if (boot.get("theme")) document.documentElement.dataset.theme = boot.get("theme");

render();
