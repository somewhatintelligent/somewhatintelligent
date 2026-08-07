/* somewhatintelligent C4 viewer — vanilla JS, no dependencies. */
"use strict";

const VM = JSON.parse(document.getElementById("viewmodel").textContent);
const SVG_NS = "http://www.w3.org/2000/svg";

// ── helpers ────────────────────────────────────────────────────────────────

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
};
const svgEl = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
};
const wrap = (text, maxChars, maxLines) => {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = (line + " " + w).trim();
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && line) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{2}$/, "…");
  }
  return lines;
};

const nodeByKey = new Map(VM.nodes.map((n) => [n.key, n]));
const systemByStack = new Map(VM.systems.map((s) => [s.stack, s]));

// ── view definitions ───────────────────────────────────────────────────────

const appSystems = VM.systems.filter((s) => !s.synthetic);
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
    title: `Container view — ${s.name} (${s.stack} @ ${VM.stage})`,
  })),
  {
    id: "components",
    label: "Commerce Core interior",
    lvl: "L3",
    title: "Component view — Commerce Core (hand-authored teaser)",
  },
];

// ── graph shaping per view ─────────────────────────────────────────────────

const systemOf = (key) => {
  if (key.startsWith("actor/")) return key;
  const stack = key.split("/")[0];
  return systemByStack.has(stack) ? "sys:" + stack : key;
};

function landscapeGraph() {
  const nodes = [];
  for (const a of VM.nodes.filter((n) => n.role === "person")) {
    nodes.push({
      key: a.key,
      name: a.name,
      role: "person",
      kindLine: "[Person]",
      desc: a.description,
      col: 0,
    });
  }
  for (const s of VM.systems) {
    nodes.push({
      key: "sys:" + s.stack,
      name: s.name,
      role: s.external ? "system-ext" : s.synthetic ? "system-ext" : "system",
      kindLine: s.external
        ? "[Software System — external]"
        : s.synthetic
          ? "[Software System — foundation]"
          : "[Software System]",
      desc: s.description,
      col: s.external || s.synthetic ? 2 : 1,
      stack: s.stack,
    });
  }
  const byPair = new Map();
  for (const e of VM.edges) {
    const from = systemOf(e.from);
    const to = systemOf(e.to);
    if (from === to) continue;
    const id = from + "→" + to;
    if (!byPair.has(id))
      byPair.set(id, { from, to, labels: [], provenance: "asserted", technologies: new Set() });
    const p = byPair.get(id);
    if (!p.labels.includes(e.label)) p.labels.push(e.label);
    if (e.technology) p.technologies.add(e.technology);
    if (e.provenance === "extracted") p.provenance = "extracted";
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
  const neighborKeys = new Set();
  for (const e of touching) {
    if (!memberKeys.has(e.from)) neighborKeys.add(e.from);
    if (!memberKeys.has(e.to)) neighborKeys.add(e.to);
  }
  const nodes = [];
  const colOf = (n) =>
    n.role === "edge" ? 1 : n.role === "compute" ? 2 : n.role === "dev" ? 2 : 3;
  for (const key of memberKeys) {
    const n = nodeByKey.get(key);
    nodes.push({
      key,
      name: n.name,
      role: n.role,
      kindLine: containerKindLine(n),
      desc: n.description,
      domain: n.domain,
      col: colOf(n),
      member: true,
    });
  }
  for (const key of neighborKeys) {
    const n = nodeByKey.get(key);
    if (!n) continue;
    const initiates = touching.some((e) => e.from === key && memberKeys.has(e.to));
    nodes.push({
      key,
      name: n.name,
      role: n.role === "person" ? "person" : "external",
      kindLine:
        n.role === "person"
          ? "[Person]"
          : `[${n.stack === "actors" ? "Person" : (systemByStack.get(n.stack)?.name ?? n.stack)}]`,
      desc: "",
      compact: true,
      col: initiates ? 0 : 4,
    });
  }
  const edges = touching.map((e) => ({ ...e }));
  const sys = systemByStack.get(stack);
  return {
    nodes,
    edges,
    boundary: { label: `${sys.name} — ${stack} @ ${VM.stage}`, memberOnly: true },
  };
}

function componentsGraph() {
  const c = VM.components;
  const colFor = { surface: 0, domain: 1, port: 2, adapter: 3 };
  const nodes = c.components.map((m) => ({
    key: "cmp:" + m.name,
    name: m.name,
    role: m.kind === "port" ? "edge" : m.kind === "adapter" ? "external" : "compute",
    kindLine: `[Component — ${m.kind}]`,
    desc: m.description,
    col: colFor[m.kind],
  }));
  const edges = c.wiring.map((w) => ({
    from: "cmp:" + w.from,
    to: "cmp:" + w.to,
    label: w.label,
    provenance: "asserted",
  }));
  return {
    nodes,
    edges,
    boundary: { label: `Commerce Core worker — hexagonal interior (hand-authored)` },
  };
}

function containerKindLine(n) {
  const t = n.technology || n.type || "";
  const kind =
    n.role === "datastore"
      ? "Container — data"
      : n.role === "edge"
        ? "Infrastructure"
        : n.role === "schema"
          ? "Build-time"
          : n.role === "dev"
            ? "Dev only"
            : "Container";
  return `[${kind}: ${t}]`;
}

// ── layout ─────────────────────────────────────────────────────────────────

const SIZES = {
  person: { w: 180, h: 82 },
  system: { w: 226, h: 104 },
  "system-ext": { w: 226, h: 96 },
  card: { w: 204, h: 88 },
  compact: { w: 168, h: 46 },
};
const sizeOf = (n) => {
  if (n.compact) return SIZES.compact;
  if (n.role === "person") return SIZES.person;
  if (n.role === "system" || n.role === "system-ext") return SIZES[n.role];
  return SIZES.card;
};

function layout(graph) {
  const COL_W = 318;
  const ROW_GAP = 36;
  const cols = new Map();
  for (const n of graph.nodes) {
    if (!cols.has(n.col)) cols.set(n.col, []);
    cols.get(n.col).push(n);
  }
  const colIndexes = [...cols.keys()].sort((a, b) => a - b);
  // two barycenter passes to reduce crossings
  const pos = new Map(graph.nodes.map((n, i) => [n.key, i]));
  const neighborsOf = (key) =>
    graph.edges
      .filter((e) => e.from === key || e.to === key)
      .map((e) => (e.from === key ? e.to : e.from));
  for (const pass of [0, 1]) {
    const order = pass === 0 ? colIndexes : [...colIndexes].reverse();
    for (const ci of order) {
      cols.get(ci).sort((a, b) => {
        const avg = (n) => {
          const ns = neighborsOf(n.key)
            .map((k) => pos.get(k))
            .filter((v) => v !== undefined);
          return ns.length ? ns.reduce((s, v) => s + v, 0) / ns.length : pos.get(n.key);
        };
        return avg(a) - avg(b);
      });
      cols.get(ci).forEach((n, i) => pos.set(n.key, i));
    }
  }
  // assign coordinates, centering each column vertically
  const colHeights = new Map();
  for (const ci of colIndexes) {
    const h = cols.get(ci).reduce((s, n) => s + sizeOf(n).h + ROW_GAP, -ROW_GAP);
    colHeights.set(ci, h);
  }
  const maxH = Math.max(...colHeights.values());
  const placed = new Map();
  colIndexes.forEach((ci, i) => {
    let y = (maxH - colHeights.get(ci)) / 2;
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
  const width = 40 + colIndexes.length * COL_W + 40;
  const height = maxH + 120;
  return { placed, width, height };
}

// ── rendering ──────────────────────────────────────────────────────────────

const app = document.getElementById("app");
let currentView = "landscape";
let selectedKey = null;
let viewBox = { x: 0, y: 0, w: 1200, h: 800 };
let svg, contentBounds;

function renderView() {
  app.textContent = "";
  const view = views.find((v) => v.id === currentView);

  app.append(
    el(
      "div",
      { class: "topbar" },
      el("h1", { text: "somewhatintelligent · topology" }),
      el("span", { class: "view-title", text: view.title }),
      el("span", { class: "spacer" }),
      el("span", { class: "badge stage", text: "stage " + VM.stage }),
      el("span", { class: "badge", text: "generated " + VM.generatedAt.slice(0, 10) }),
    ),
  );

  const nav = el("nav", {});
  for (const v of views) {
    nav.append(
      el(
        "button",
        {
          class: "viewlink" + (v.id === currentView ? " active" : ""),
          onclick: () => {
            currentView = v.id;
            selectedKey = null;
            render();
          },
        },
        el("span", { class: "lvl", text: v.lvl }),
        document.createTextNode(v.label),
      ),
    );
  }
  const rail = el("div", { class: "rail" }, el("h2", { text: "C4 views" }), nav, legend());
  app.append(rail);

  const graph =
    currentView === "landscape"
      ? landscapeGraph()
      : currentView === "components"
        ? componentsGraph()
        : systemGraph(currentView.slice(7));
  app.append(canvas(graph));
  app.append(inspector());
}

function legend() {
  const item = (cls, label) =>
    el(
      "div",
      { class: "k" },
      el("span", { class: "swatch", style: swatchStyle(cls) }),
      document.createTextNode(label),
    );
  const stroke = (dashed, label) =>
    el(
      "div",
      { class: "k" },
      el("span", { class: "stroke" + (dashed ? " dashed" : "") }),
      document.createTextNode(label),
    );
  return el(
    "div",
    { class: "legend" },
    item("compute", "application (runs code)"),
    item("datastore", "data store / queue"),
    item("edge", "access & wiring"),
    item("external", "external system"),
    item("person", "person / agent"),
    stroke(false, "extracted from IaC graph"),
    stroke(true, "asserted (cited in code)"),
    el("div", { class: "k", text: "arrows read “A → uses → B”" }),
  );
}
function swatchStyle(role) {
  return `border-color: var(--${role === "edge" ? "edge-role" : role}); background: var(--${role === "edge" ? "edge-role" : role}-fill, transparent)`;
}

function canvas(graph) {
  const { placed, width, height } = layout(graph);
  contentBounds = { width, height };
  svg = svgEl("svg", { role: "img", "aria-label": views.find((v) => v.id === currentView).title });
  const defs = svgEl(
    "defs",
    {},
    marker("arr", "var(--ink-soft)"),
    marker("arr-hot", "var(--accent)"),
  );
  const root = svgEl("g", {});
  svg.append(defs, root);

  // system boundary
  if (graph.boundary) {
    const members = [...placed.values()].filter(
      (n) => !graph.boundary.memberOnly || n.member || n.key.startsWith("cmp:"),
    );
    if (members.length) {
      const minX = Math.min(...members.map((n) => n.x)) - 22;
      const minY = Math.min(...members.map((n) => n.y)) - 30;
      const maxX = Math.max(...members.map((n) => n.x + n.w)) + 22;
      const maxY = Math.max(...members.map((n) => n.y + n.h)) + 22;
      root.append(
        svgEl("rect", {
          class: "boundary",
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          rx: 14,
        }),
        svgEl(
          "text",
          { class: "boundary-label", x: minX + 12, y: minY - 8 },
          document.createTextNode(graph.boundary.label),
        ),
      );
    }
  }

  // Edges render under nodes. Attachment points fan out along each node's
  // side (sorted by the far endpoint's y) so a hub like a shared database
  // doesn't collapse every arrow into one point.
  const edgeLayer = svgEl("g", {});
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
  const addAttach = (node, side, entry) => {
    const k = node.key + ":" + side;
    if (!attach.has(k)) attach.set(k, { node, list: [] });
    attach.get(k).list.push(entry);
  };
  for (const d of descs) {
    addAttach(d.a, d.srcSide, { d, isSrc: true, otherY: d.b.y + d.b.h / 2 });
    addAttach(d.b, d.tgtSide, { d, isSrc: false, otherY: d.a.y + d.a.h / 2 });
  }
  for (const { node, list } of attach.values()) {
    list.sort((p, q) => p.otherY - q.otherY);
    list.forEach((p, i) => {
      const f = list.length === 1 ? 0.5 : 0.2 + (0.6 * i) / (list.length - 1);
      const y = node.y + node.h * f;
      if (p.isSrc) p.d.srcY = y;
      else p.d.tgtY = y;
    });
  }
  let loopNth = 0;
  for (const d of descs) edgeLayer.append(edgeEl(d, d.same ? loopNth++ : 0));
  root.append(edgeLayer);

  for (const n of placed.values()) root.append(nodeEl(n));

  fitView();
  attachPanZoom();

  const wrapEl = el("div", { class: "canvas-wrap" });
  wrapEl.append(svg);
  wrapEl.append(
    el(
      "div",
      { class: "zoombar" },
      el("button", { text: "+", "aria-label": "zoom in", onclick: () => zoom(0.8) }),
      el("button", { text: "−", "aria-label": "zoom out", onclick: () => zoom(1.25) }),
      el("button", {
        text: "⤢",
        "aria-label": "fit",
        onclick: () => {
          fitView();
          applyViewBox();
        },
      }),
    ),
    el("div", {
      class: "canvas-hint",
      text: "drag to pan · wheel to zoom · click a node to inspect",
    }),
  );
  return wrapEl;
}

function marker(id, color) {
  const m = svgEl("marker", {
    id,
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: "auto-start-reverse",
  });
  m.append(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }));
  return m;
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
  const g = svgEl("g", { class: "edge " + e.provenance, "data-from": e.from, "data-to": e.to });
  // Redundant sid: "binds CommerceDatabase" on an arrow INTO Commerce DB says
  // nothing the target doesn't; compress to the verb.
  let label = e.label;
  const targetId = (b.key.split("/").pop() || "").toLowerCase();
  const suffix = (label.split(" ").pop() || "").toLowerCase();
  if (
    (label.startsWith("binds ") || label.startsWith("env ")) &&
    targetId.includes(suffix.replace(/_/g, ""))
  ) {
    label = label.split(" ")[0] === "env" ? "env" : "binds";
  }
  const y1 = d.srcY ?? a.y + a.h / 2;
  const y2 = d.tgtY ?? b.y + b.h / 2;
  if (d.same) {
    // Same column: bulge into the emptier side (left of the compute column,
    // right otherwise) so the loop doesn't cross the neighbouring column.
    const left = d.loopLeft;
    const sx = left ? a.x : a.x + a.w;
    const tx = left ? b.x : b.x + b.w;
    const bulge = (34 + loopNth * 16) * (left ? -1 : 1);
    const p0 = { x: sx, y: y1 };
    const p1 = { x: sx + bulge, y: y1 };
    const p2 = { x: tx + bulge, y: y2 };
    const p3 = { x: tx + (left ? -3 : 3), y: y2 };
    const path = svgEl("path", {
      d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`,
      "marker-end": "url(#arr)",
    });
    const lp = pointOnCubic(p0, p1, p2, p3, 0.5);
    g.append(path, edgeLabel(lp.x + bulge * 0.4, lp.y, label, left ? "end" : "start"));
    return g;
  }
  const ltr = d.srcSide === "R";
  const p0 = { x: ltr ? a.x + a.w : a.x, y: y1 };
  const p3 = { x: ltr ? b.x : b.x + b.w, y: y2 };
  const dx = (p3.x - p0.x) / 2;
  const p1 = { x: p0.x + dx, y: p0.y };
  const p2 = { x: p3.x - dx, y: p3.y };
  const path = svgEl("path", {
    d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`,
    "marker-end": "url(#arr)",
  });
  // Label rides the curve near the source — the middle of the canvas is
  // where curves cross, the first third is usually clear.
  const lp = pointOnCubic(p0, p1, p2, p3, 0.32);
  g.append(path, edgeLabel(lp.x, lp.y - 6, label, "middle"));
  return g;
}
function edgeLabel(x, y, text, anchor) {
  const t = svgEl("text", { x, y, "text-anchor": anchor || "middle" });
  t.textContent = text;
  return t;
}

function nodeEl(n) {
  const g = svgEl("g", {
    class: `node role-${n.role}` + (n.key === selectedKey ? " selected" : ""),
    tabindex: 0,
    role: "button",
    "aria-label": n.name,
    "data-key": n.key,
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
  const cx = n.x + n.w / 2;
  let ty = n.y + 20;
  g.append(
    svgEl(
      "text",
      { class: "name", x: cx, y: ty, "text-anchor": "middle" },
      document.createTextNode(n.name),
    ),
  );
  ty += 13;
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
    const maxChars = Math.floor((n.w - 22) / 5.4);
    for (const line of wrap(n.desc, maxChars, n.role.startsWith("system") ? 3 : 2)) {
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
        { class: "domain", x: cx, y: n.y + n.h - 8, "text-anchor": "middle" },
        document.createTextNode(n.domain),
      ),
    );
  }
  const select = () => {
    selectedKey = n.key;
    render();
  };
  g.addEventListener("click", (ev) => {
    ev.stopPropagation();
    select();
  });
  g.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      select();
    }
  });
  g.addEventListener("mouseenter", () => highlight(n.key, true));
  g.addEventListener("mouseleave", () => highlight(n.key, false));
  return g;
}

function highlight(key, on) {
  for (const edge of svg.querySelectorAll(".edge")) {
    const touches = edge.dataset.from === key || edge.dataset.to === key;
    edge.classList.toggle("hot", on && touches);
    edge.classList.toggle("dim", on && !touches);
    const p = edge.querySelector("path");
    p.setAttribute("marker-end", on && touches ? "url(#arr-hot)" : "url(#arr)");
  }
  for (const node of svg.querySelectorAll(".node")) {
    if (!on) {
      node.classList.remove("dim");
      continue;
    }
    const k = node.dataset.key;
    const connected =
      k === key ||
      [...svg.querySelectorAll(".edge")].some(
        (e) =>
          (e.dataset.from === key && e.dataset.to === k) ||
          (e.dataset.to === key && e.dataset.from === k),
      );
    node.classList.toggle("dim", !connected);
  }
}

// ── pan & zoom ─────────────────────────────────────────────────────────────

function fitView() {
  const pad = 20;
  viewBox = {
    x: -pad,
    y: -pad,
    w: contentBounds.width + pad * 2,
    h: contentBounds.height + pad * 2,
  };
  applyViewBox();
}
function applyViewBox() {
  svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
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
      const px = viewBox.x + ((ev.clientX - rect.left) / rect.width) * viewBox.w;
      const py = viewBox.y + ((ev.clientY - rect.top) / rect.height) * viewBox.h;
      zoom(ev.deltaY > 0 ? 1.12 : 0.89, px, py);
    },
    { passive: false },
  );
  svg.addEventListener("click", (ev) => {
    if (!ev.target.closest(".node")) {
      selectedKey = null;
      render();
    }
  });
}

// ── inspector ──────────────────────────────────────────────────────────────

function inspector() {
  const panel = el("div", { class: "inspector" + (selectedKey ? " open" : "") });
  if (!selectedKey) return panel;

  const inner = el("div", { class: "inner" });
  panel.append(inner);

  const key = selectedKey;
  const vmNode = nodeByKey.get(key);
  const sysMeta = key.startsWith("sys:") ? systemByStack.get(key.slice(4)) : null;
  const cmp = key.startsWith("cmp:")
    ? VM.components.components.find((c) => "cmp:" + c.name === key)
    : null;

  const name = sysMeta?.name ?? cmp?.name ?? vmNode?.name ?? key;
  const desc = sysMeta?.description ?? cmp?.description ?? vmNode?.description ?? "";

  inner.append(
    el("button", {
      class: "close",
      text: "✕",
      "aria-label": "close inspector",
      onclick: () => {
        selectedKey = null;
        render();
      },
    }),
    el("h3", { text: name }),
    el("div", {
      class: "meta",
      text: sysMeta
        ? "software system"
        : cmp
          ? `component — ${cmp.kind}`
          : `${vmNode.type ?? vmNode.technology}`,
    }),
    el("p", { class: "desc", text: desc }),
  );

  if (vmNode) {
    const dl = el("dl", {});
    const row = (k, v) => {
      if (!v) return;
      dl.append(el("dt", { text: k }), el("dd", { text: String(v) }));
    };
    row("stack", vmNode.stack);
    row("fqn", vmNode.fqn);
    row("type", vmNode.type);
    row("domain", vmNode.domain);
    row("service", vmNode.serviceName);
    row("exported", vmNode.exported ? "yes — part of the stack's output contract" : undefined);
    row(
      "provenance",
      vmNode.extracted ? "extracted from alchemy stack eval" : "asserted in overlay model",
    );
    inner.append(dl);
  }

  // relationships (from the full edge set, not just this view)
  const rel = (list, dir) => {
    const ul = el("ul", { class: "rels" });
    for (const e of list) {
      const otherKey = dir === "out" ? e.to : e.from;
      const other = nodeByKey.get(otherKey);
      const li = el("li", { class: e.provenance });
      li.append(
        el(
          "div",
          {},
          document.createTextNode((dir === "out" ? "→ " : "← ") + (other?.name ?? otherKey)),
          el("span", { class: "prov " + e.provenance, text: e.provenance }),
        ),
        el("div", {
          class: "lbl",
          text:
            e.label +
            (e.technology ? ` · ${e.technology}` : "") +
            (e.detail ? ` · ${e.detail}` : ""),
        }),
      );
      ul.append(li);
    }
    return ul;
  };
  const outs = VM.edges.filter((e) => e.from === key);
  const ins = VM.edges.filter((e) => e.to === key);
  if (outs.length) inner.append(el("h4", { text: "uses" }), rel(outs, "out"));
  if (ins.length) inner.append(el("h4", { text: "used by" }), rel(ins, "in"));

  if (vmNode?.extracted && vmNode.props) {
    inner.append(
      el("h4", { text: "extracted props" }),
      el("pre", { text: JSON.stringify(vmNode.props, null, 2) }),
    );
  }
  return panel;
}

// ── boot ───────────────────────────────────────────────────────────────────

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && selectedKey) {
    selectedKey = null;
    render();
  }
});

// Deep links: #view=<id>&select=<node key>
const boot = new URLSearchParams(location.hash.slice(1));
if (boot.get("view") && views.some((v) => v.id === boot.get("view")))
  currentView = boot.get("view");
if (boot.get("select")) selectedKey = boot.get("select");
if (boot.get("theme")) document.documentElement.dataset.theme = boot.get("theme");
const syncHash = () => {
  const p = new URLSearchParams();
  p.set("view", currentView);
  if (selectedKey) p.set("select", selectedKey);
  history.replaceState(null, "", "#" + p.toString());
};
function render() {
  renderView();
  syncHash();
}
render();
