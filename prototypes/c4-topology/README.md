# c4-topology — alchemy deployment topology → explorable C4 diagrams

A spike: take the alchemy resource graph **from code to visual code** — an
explorable, multi-level C4 rendering of the whole estate that both humans and
agents can navigate, generated mechanically from the stacks themselves.

```sh
# 1. capture the IaC graph (no deploy, no credentials — sandbox eval only)
SANDBOX=1 CI=1 bun prototypes/c4-topology/extract.ts --stage dev_claude

# 2. capture the code graph (L3/L4). Two interchangeable producers:
bun prototypes/c4-topology/oxgraph.ts     # native oxc — default, ~1.7s, no subprocess
bun prototypes/c4-topology/codegraph.ts   # lift fallow's viz payload instead

# 3. render it
bun prototypes/c4-topology/generate.ts

# 4. open
open prototypes/c4-topology/index.html   # deep links: #view=…&select=…&theme=dark
```

## Files

| file              | role                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `extract.ts`      | evaluates every `alchemy.run.ts` and walks alchemy's Output-expression AST → `topology.json` (nodes, edges, props, cross-stack refs)  |
| `model.ts`        | the C4 overlay: systems, people, per-resource intent, and _asserted_ runtime edges with code citations                                |
| `generate.ts`     | merges extraction + overlay into a viewmodel, inlines `viewer.css`/`viewer.js` → self-contained `index.html`                          |
| `viewer.{css,js}` | dependency-free renderer: layered layout, pan/zoom, hover isolation, inspector, light+dark                                            |
| `oxgraph.ts`      | native code-graph extraction with `oxc-parser` + `oxc-resolver` → `codegraph.json`; reads `.fallowrc.jsonc` for entries/ignores/zones |
| `codegraph.ts`    | the alternative producer: runs `fallow viz` and lifts its embedded `__FALLOW_DATA__` viewmodel into the same `codegraph.json` schema  |
| `topology.json`   | captured IaC extraction (committed so the diagram is reproducible without running stacks)                                             |
| `codegraph.json`  | captured fallow code graph (per-file metrics incl. per-function complexity)                                                           |
| `index.html`      | the deliverable — works from `file://`, no network                                                                                    |

## Why this shape (the research, condensed)

### The C4 model fits alchemy almost perfectly

C4's core move is **abstraction-first, single model → many views**: a
non-visual directed graph of Person → Software System → Container → Component,
with diagrams as mere views at different zoom levels. That "model is just
data" stance is exactly what an IaC engine already holds:

- an alchemy **Stack** ≈ a C4 **software system** (one team, deployed together)
- a **Worker / D1 / R2 / Queue** ≈ a C4 **container** (C4 explicitly calls
  serverless functions and data stores containers — "something that must be
  running for the system to work")
- **Access apps, queue-consumer wiring, DNS** ≈ C4 **infrastructure nodes**
- a **stage** ≈ a C4 **deployment environment** (one deployment diagram per
  environment; this prototype renders one stage per capture)
- the **hexagonal Effect interior** of a worker ≈ C4 **components** — the
  level IaC cannot see (hand-authored teaser here; see "Next", below)

C4's notation checklist drove the renderer: every element carries name +
`[type: technology]` + description, every arrow is labelled and
unidirectional ("A → uses → B"), there is always a key, and every view has a
title + scope.

### How to get the graph out of alchemy (the four seams)

Researched against `alchemy@2.0.0-beta.70` source (which ships TS sources —
every internal is importable as `alchemy/<File>`):

1. **Seam A — read persisted state.** Every state row already contains
   `resourceType`, `fqn`, `namespace`, `props`, `attr`, `bindings[]` and —
   crucially — `downstream: string[]`, the reverse dependency edges alchemy's
   planner computes and `Apply` stamps into state. `alchemy state export
--local` (or `exportState` from `alchemy/State/Export`) is a zero-code
   graph dump. Limitation: only deployed stages; cross-stack refs are _not_
   in `downstream` (by design — they resolve against another stack's store).

2. **Seam B — evaluate without deploying** _(what `extract.ts` does)_.
   `evalStack` compiles a stack into `CompiledStack {resources, bindings,
output}` where Props still carry the **Output expression AST**. Same-stack
   edges come from `Output.upstreamAny(props)` — the very walk `Plan.make`
   uses — and cross-stack edges from probing `RefExpr` / `StackRefExpr` /
   `Ref` metadata in that AST. No credentials, no network, no state
   mutation: this is "the plan phase minus the cloud".

3. **Seam C — a recording state layer.** `State` is an ordinary Effect
   service (`infra/state.ts` already swaps implementations under `SANDBOX`).
   A ~20-line wrapper that tees every `set` (each carries the full
   `ResourceState` incl. `downstream`) and every cross-stack
   `getOutput`/ref read would capture the graph **live during real
   deploys** — including the cross-stack edges Seam A misses, because the
   cross-stack _read itself_ is the edge. This is the right long-term
   "always-on" collector.

4. **Seam D — AST parsing of `alchemy.run.ts`.** Strictly worse than B:
   the runtime already holds the resolved graph; static analysis would
   re-derive it lossily. Rejected.

### Traps hit while walking alchemy's expression graph (worth knowing)

- **Expression proxies are `typeof "function"`.** Any naive
  "skip non-objects" walk silently drops exactly the values carrying edges
  (`queueId`, `migrationsDir`, `allowedIdps[0]`…). Probe first, type-check
  later.
- **`isRef` is a lie on expression proxies.** An Output proxy's `get` trap
  mints a truthy `PropExpr` for _any_ key — including the `RefMetadata`
  symbol probe. Check `isExpr` first and validate the metadata shape.
- **Never coerce.** Proxies throw on `Symbol.toPrimitive` (deliberately —
  that guard stops unresolved outputs leaking into cloud props). Unwrap via
  `Symbol.for("alchemy/Expr")` before touching fields.
- **`evalStack` alone dies** ("Service not found: alchemy/Context") on this
  repo's stacks; mirror the CLI's own layer stack from `Cli/main.ts` +
  `execStack` instead (see `extract.ts` header).
- Cross-stack `yield* OtherStack` resolves **at eval time from the local
  state store**, so the referenced stack must have run once in sandbox from
  the same cwd (`.alchemy/state` is cwd-keyed). One `SANDBOX=1 alchemy dev`
  of `platform.auth` seeds enough for everything else to eval.

### Provenance is the design's spine

The viewer draws **extracted** edges solid and **asserted** edges dashed,
and the inspector badges every relationship with its provenance plus the
prop path (`binding:COMMERCE`, `env.AUTH_ORIGIN`) or code citation
(`infra/telemetry.ts`). The point: an agent consuming this diagram can tell
"the machine proved this" from "a human claimed this" — which is what makes
it safe to _act_ on.

## What the capture found (stage `dev_claude`)

24 resources, ~40 edges across 4 app stacks — including edges that only
exist because the walker understands alchemy's internals:

- `AuthMigrations → AuthDatabase @migrationsDir` (Drizzle wiring)
- `Settlement → CommercePaymentEvents` via collapsed `Queues.Consumer`
- `Cloudflare@production → {OperatorAccess, InboxAccess, MezedesAccess}`
  (every internal Access surface leans on the production Zero Trust stack —
  visible as cross-stack `StackRefExpr`s)
- `SomewhatIntelligentAuth → Site @env.AUTH_ORIGIN` (the `yield* Auth`
  contract, captured as a real expression edge)
- `StripeListener` correctly appears as dev-only tooling

## Levels 3–4: the code graph

The code level has two interchangeable producers writing the same
`codegraph.json` schema. `generate.ts` consumes whichever ran last and labels
the views with its name, so the diagram always states its own provenance.

### `oxgraph.ts` — native oxc (the default)

fallow is a Rust tool built on **oxc**, and oxc ships napi bindings — so the
same engine is directly available in-process. `oxgraph.ts` does the whole
pipeline itself: discover sources → `oxc-parser` for the module record and AST
(`.astro` contributes both its frontmatter fence and its non-inline `<script>`
blocks) → `oxc-resolver` against each file's nearest tsconfig (with realpath
normalization, since bun workspace deps are symlinks) → import edges with
type-only flags, per-function cyclomatic/cognitive complexity, unused-export
candidates, Tarjan cycles, and boundary violations.

It reads **`.fallowrc.jsonc`** rather than inventing its own model: the repo's
`entry` globs, `ignorePatterns`, and the whole `boundaries` block (zones in
declaration order — first match wins — and `rules` as allow-lists). So the
zones on the diagram are literally the zones the repo declares.

**Validated against fallow on this repo: 1489 of 1489 import edges identical,
149/150 type-only flags agree, zone assignments match** (app-core 22, lib 27,
platform-pkg 101, platform-app 333, product-app/mezedes 43, infra 9), and both
find the same single boundary violation. Runtime ~1.7s for 535 files.

### Where fallow is still the better tool

The parity above is on the _import graph_. Everything past that, fallow does
better, and the honest split is:

|                                                  | oxgraph                                                                                                       | fallow                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| import graph, type-only flags, zones             | identical                                                                                                     | identical                                                                      |
| per-function complexity                          | approximate (nesting-weighted)                                                                                | sonar-exact, with per-contribution breakdown                                   |
| unused exports                                   | **candidates only** — syntactic; can't see type-position uses, so types are excluded rather than over-claimed | checker-grade, incl. re-export chains through barrels and `--type-aware` proof |
| per-export consumers                             | not modeled                                                                                                   | `--trace-file` → `referenced_by[{from_file, kind}]`                            |
| duplication, hotspots, framework entry detection | none                                                                                                          | built in (87 clone groups here)                                                |

So: **oxgraph owns the graph** (it's fast, dependency-light, runs in-process,
and needs no binary), and **fallow owns the semantics**. The natural next step
is to keep oxgraph as the structural producer and enrich it from fallow's JSON
where fallow is authoritative — `fallow dead-code --format json` for proven
unused exports and cycles, `--trace-file` for symbol-level consumer edges —
rather than choosing one. Both scripts stay in the repo for that reason.

### The L2→L4 join is mechanical

Every Worker's extracted props carry `main` (entry file) or `rootDir`.
`generate.ts` BFSes the import graph from that anchor to get the container's
code closure, then:

- **L3** — folders (and imported workspace packages) become components, with
  aggregated import edges, per-module fn/complexity rollups, and import-depth
  layering (entry at the left).
- **L4** — every module appears in the left rail under its active code map
  (and responds to double-click on the diagram). File nodes carry the function
  inventory: name, line, cyclomatic, cognitive. Type-only imports render
  dotted; boundary violations render red — this repo has exactly one,
  `platform.site/src/core/product-view.ts` → `platform.commerce/domain/Contracts.ts`
  (app-core reaching into platform-app; type-only, visible on the Storefront map).

## The look is `platform.design`, not a palette I invented

`generate.ts` inlines `packages/platform.design/generated/css/tokens.css`
verbatim, so the viewer is written against the same `--color-*` contract every
other SI surface uses. `viewer.css` contains **no colour literals** — retint
`src/tokens/brand.ts`, re-run the design system's codegen, and this viewer
follows. Barlow Condensed Black is embedded as a data URI (110 KB, the display
voice); Iosevka and Source Serif are ~1.5 MB each, so they stay as the fallback
stacks the tokens already declare.

Three rules from the brand study do real information-design work here:

- **Cold proof paper → garment black.** The rail is the garment, the canvas is
  paper. In dark mode the rail lifts to `surface-raised` instead of inverting,
  because inverting an already-black page turns it white.
- **Depth is drawn, never diffused.** No blurred shadows anywhere — element
  kind is encoded by _border treatment_ (solid = runs code, sunken fill =
  stores data, dashed = wiring, dotted = build-time) exactly as
  `DESIGN_SYSTEM.md` prescribes, so no new hues were needed.
- **Pink is scarce** — the private correction crossing a public interface. It
  means "you are here / you selected this" and nothing else.

The payoff is that colour now means exactly one thing: something is wrong. Red
and amber are the only other hues on the page, so a boundary breach or a
complexity hotspot is visible before it is read. The mark in the masthead is
the FRIEND declaration's asterisk, drawn at `currentColor` from
`platform.design/logo`.

Running the design system's own gate over this directory
(`bun run packages/platform.design/scripts/brand-lint.ts prototypes/c4-topology`)
reports zero hex literals. Its nine remaining findings are false positives —
the Tailwind-utility regex matching SVG attribute names (`text-anchor`,
`stroke-width`) and one JSON field (`from_zone`).

## Ideation / next steps

- **Effect-aware components.** fallow gives folder/file/function structure;
  an `effect`-aware pass (service tags, Layer composition, RPC surfaces)
  would name the _ports_ those folders implement — upgrading the mechanical
  L3 from "directories" to true hexagonal components. fallow's boundary
  `hexagonal` preset can then enforce what the diagram shows.
- **Seam C recorder in `infra/state.ts`** → topology captured on every real
  deploy, per stage; diff two captures to render _change_ (what a PR adds /
  removes / rewires) — a reviewable architectural diff.
- **Deployment view per stage**: same model, one view per stage
  (`production` vs `dev_*`), showing domains claimed, tier-gated resources
  (telemetry, Access) appearing/disappearing.
- **The system view**: attach docs, ADRs, test coverage, dashboards and
  runbooks to nodes (the inspector already has the surface for it); serve it
  from a Worker; let agents query the model as JSON (`topology.json` _is_
  the API) while humans get the picture.
- **Image export for agent context**: the SVG is one `viewBox` — rendering
  PNG per view (as done during development with headless Chromium) gives
  compact visual context for models; the HTML remains the navigable form.
