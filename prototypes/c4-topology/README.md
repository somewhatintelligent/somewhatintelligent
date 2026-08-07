# c4-topology — alchemy deployment topology → explorable C4 diagrams

A spike: take the alchemy resource graph **from code to visual code** — an
explorable, multi-level C4 rendering of the whole estate that both humans and
agents can navigate, generated mechanically from the stacks themselves.

```sh
# 1. capture the graph (no deploy, no credentials — sandbox eval only)
SANDBOX=1 CI=1 bun prototypes/c4-topology/extract.ts --stage dev_claude

# 2. render it
bun prototypes/c4-topology/generate.ts

# 3. open
open prototypes/c4-topology/index.html   # deep links: #view=…&select=…&theme=dark
```

## Files

| file              | role                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `extract.ts`      | evaluates every `alchemy.run.ts` and walks alchemy's Output-expression AST → `topology.json` (nodes, edges, props, cross-stack refs) |
| `model.ts`        | the C4 overlay: systems, people, per-resource intent, and _asserted_ runtime edges with code citations                               |
| `generate.ts`     | merges extraction + overlay into a viewmodel, inlines `viewer.css`/`viewer.js` → self-contained `index.html`                         |
| `viewer.{css,js}` | dependency-free renderer: layered layout, pan/zoom, hover isolation, inspector, light+dark                                           |
| `topology.json`   | captured extraction (committed so the diagram is reproducible without running stacks)                                                |
| `index.html`      | the deliverable — works from `file://`, no network                                                                                   |

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

## Ideation / next steps

- **Component level, mechanically.** The hexagonal interior (Effect service
  tags, Layer composition, RPC surfaces) is statically visible to
  `effect`-aware tooling. Extracting "which domain modules touch which
  ports" would fill C4 level 3 the same way Output-walking filled level 2.
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
