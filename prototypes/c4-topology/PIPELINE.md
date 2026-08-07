# From spike to pipeline — design note

> Status: **not built.** This is the design discussion for what the prototype
> would have to become to be repeatable. Nothing here exists in code yet; the
> spike deliberately stops at "prove the picture is worth having."

## The honest audit

The prototype mixes two very different kinds of content, and the artifact does
not currently admit which is which at a glance.

|                                                 | Source                                 | Count      | Repeatable? |
| ----------------------------------------------- | -------------------------------------- | ---------- | ----------- |
| Resources, types, props                         | `extract.ts` — alchemy stack eval      | 24         | yes         |
| IaC edges (bindings, cross-stack refs)          | `extract.ts` — Output AST walk         | 40         | yes         |
| Files, imports, type-only flags                 | `oxgraph.ts` — oxc                     | 535 / 1489 | yes         |
| Functions + complexity                          | `oxgraph.ts` — oxc AST                 | 1881       | yes         |
| Dead exports, boundary violations               | `fallow dead-code` + `.fallowrc` zones | 4 / 1      | yes         |
| **System names & descriptions**                 | **`model.ts` — written by an LLM**     | **7**      | **no**      |
| **Actors (Visitor, Operator, AI Agent)**        | **`model.ts`**                         | **3**      | **no**      |
| **Per-resource names & descriptions**           | **`model.ts`**                         | **28**     | **no**      |
| **Runtime edges ("sends mail", "OTLP export")** | **`model.ts`, each citing a file**     | **18**     | **no**      |
| **Commerce Core's hexagonal interior**          | **`model.ts` — hand-drawn**            | **11**     | **no**      |

549 lines of `model.ts` are assertions. Every human-readable name at L1 and L2
— "Identity App", "Commerce Core", "the only public door into auth" — was
written by a model that read the code once, then frozen into a TypeScript
file. That is why the artifact reads clean: someone wrote the prose. It is
also why, as-is, this does not scale past one repository at one moment in
time.

Three specific failure modes:

1. **It does not repeat.** Point this at another repo and you get a correct
   graph with `AuthWorker` / `Cloudflare.Worker` on every node and no
   descriptions at all.
2. **It goes stale silently.** Rename a worker's responsibility and the old
   sentence keeps rendering, with no signal that it is now wrong.
3. **Provenance is only half-wired.** Edges carry `extracted` vs `asserted`
   and the viewer draws them differently. Names and descriptions carry
   nothing — a reader cannot tell a proven fact from a plausible sentence.

The last one is the cheapest to fix and probably the most important, because
it converts a hidden weakness into visible state.

## What the pipeline would look like

The shape is: **a script emits a structure with holes; an agent fills only the
holes and must cite evidence; a human confirms; the result is stored as data,
content-addressed to the facts it describes.**

```
 extract.ts ─┐
 oxgraph.ts ─┼─▶ facts (topology.json, codegraph.json)   ← machine, regenerated freely
 fallow ─────┘         │
                       ▼
              annotate.ts --write
                       │        emits one entry per node:
                       │          { key, facts, fingerprint, status: "empty",
                       │            name: null, description: null, evidence: [] }
                       ▼
               annotations.json    ← DATA, committed, hand-editable
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   agent fills    human edits    facts change
   status:        status:        fingerprint mismatch
   "asserted"     "confirmed"    → status: "stale"
        └──────────────┼──────────────┘
                       ▼
                 generate.ts  ← renders, and shows status per node
```

### Why annotations must be data, not code

`model.ts` is a TypeScript module, so writing to it means an agent editing
source. Move it to `annotations.json` and the agent is filling a form instead
— reviewable as a diff, mergeable, and impossible to accidentally make
Turing-complete.

### The fingerprint is the whole trick

Each entry hashes the _shape_ of the facts it describes — resource type,
entry file, the set of things it binds — deliberately not the values, so
renaming a bucket does not invalidate the prose but a worker gaining a
database binding does. When the hash moves, the annotation is not deleted; it
is marked `stale` and the viewer renders it as unverified. Staleness becomes
a CI signal rather than a slow rot.

### Statuses

| status      | meaning                            | rendered as                          |
| ----------- | ---------------------------------- | ------------------------------------ |
| `empty`     | no prose yet                       | falls back to the logical id, marked |
| `asserted`  | an agent wrote it, cited evidence  | shown, marked as unverified          |
| `confirmed` | a human read it and agreed         | shown plain                          |
| `stale`     | facts changed since it was written | shown struck / flagged               |

The viewer already has the vocabulary for this — provenance on edges,
severity chips on nodes. A fifth chip kind (`unverified`) and a coverage
number in the registry strip would carry it, using machinery that exists.

## The agent skill

The interesting part is that the filling step is a good fit for a skill,
because it is narrow, evidence-bound, and verifiable.

**`describe-topology`** — invoked after extraction.

- **Input**: `annotations.json` entries with `status: "empty" | "stale"`, plus
  the facts for each and read access to the repo.
- **Job**: for each hole, read the cited entry file and its imports, then write
  a name (2–4 words) and a description (one or two sentences, present tense,
  what it does and who talks to it).
- **Hard rules**:
  - never assert something derivable — if the viewer can render it from facts
    (type, domain, complexity, file count), it does not belong in prose;
  - every entry must list the files actually read as `evidence`;
  - leave the hole empty rather than guess; `empty` is a better state than
    plausible-but-wrong;
  - do not touch entries already `confirmed`.
- **Output**: the same file with holes filled and `status: "asserted"`.
- **Verification**: a second pass (or a second agent) checks each description
  against its evidence and flags ones the cited files do not support. This is
  the same adversarial-verify shape that works elsewhere.

Then a human runs through the `asserted` set and promotes what is right to
`confirmed`. That review is fast because it is a list of sentences with links,
not a diagram to interpret.

### What should never reach the agent

A large fraction of what I hand-wrote is actually derivable, and deriving it is
strictly better than asserting it:

- "no public URL — binding only" ← `workersDev: false` and no domains in props
- "Cloudflare Worker · TanStack Start" ← resource type + the framework plugin
  fallow already detects
- "11 domain tables" ← the Drizzle schema the migration resource points at
- "~32-method RPC surface" ← count the exported RPC methods with oxc
- actors ← Access applications imply an operator; a public domain implies a
  visitor; an MCP route implies an agent client

Each of those moves a line out of the assertion column permanently. The rule
of thumb: **the agent should only be asked for intent — the "why this exists"
that genuinely is not in the code.** Everything else is a missing extractor.

## Scaling past one repo

- **Per-stage, not per-repo.** Facts are captured per stage already; the
  annotation layer is stage-independent and should be keyed to the logical id,
  so production and a dev stage share prose.
- **Cross-repo.** The overlay would move next to the code it describes (an
  `annotations.json` per app), so ownership follows the code and merges follow
  the PR that changed the behaviour.
- **CI.** `annotate.ts` exits non-zero on stale entries. A PR that changes a
  worker's bindings then fails until someone re-confirms the sentence
  describing it — which is the mechanism that keeps documentation honest,
  rather than a convention nobody follows.
- **The system view.** Once annotations are data with a status, the same slot
  holds ADR links, runbooks, coverage and dashboards per node. That is the
  version of this worth building — the diagram becomes the index into
  everything else, and every entry states its own provenance.

## Open questions

- Is `confirmed` per-person or per-team, and does it expire?
- Should `stale` fall back to the previous prose (shown flagged) or to the
  logical id (shown empty)? Flagged-but-visible is probably right, but it
  means the viewer renders text it knows to be suspect.
- Where does the hand-drawn L3 (the hexagonal interior) live? It is the one
  genuinely editorial diagram here; an Effect-aware extractor could replace
  most of it, but probably not the naming of ports.
- Does the artifact itself need to carry the annotation status, or is that a
  CI concern? Leaning: carry it — a reader who cannot see what is unverified
  will trust all of it equally.
