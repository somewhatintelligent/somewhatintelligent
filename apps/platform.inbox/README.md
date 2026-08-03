# platform.inbox

The staff mailbox at `mail.somewhatintelligent.ca`, with an agent in it.

Inbound mail arrives through Cloudflare Email Routing's catch-all on the zone
and lands in the Worker's `email()` handler. Each mailbox is a Durable Object
with its own SQLite database; attachments go to R2. An `EmailAgent` (Agents SDK
over Workers AI) reads, searches, and drafts, and the same tools are exposed
over MCP at `/mcp` by an `EmailMCP` Durable Object.

## Provenance

Forked from [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox),
Apache-2.0, and still carrying its per-file copyright headers. The upstream
README's setup — the Deploy-to-Cloudflare button, `wrangler secret put`, the
dashboard steps for Access and Email Routing — does not apply here. Everything
it describes is declared in `module.ts`, with one exception noted below.

## Shape

    module.ts     the Worker, its bindings, the Access policy, email routing
    workers/      the deployed script: Hono API, DOs, agent, MCP, email handler
    app/          the React Router web client
    shared/       pure helpers both sides use, and the only tested code here

`stacks/platform.inbox/` deploys it. The app never imports the stack — the
runtime env type comes from `module.ts`, where the bindings are declared, so
`workers/types.ts` cannot drift from the infrastructure that produced it.

## Things that will bite

**The worker's physical name is `agentic-inbox-si`.** Durable Object storage is
keyed to the hosting script, so renaming it orphans every mailbox rather than
moving it. The `-si` is a fossil of the retired scope.

**The Access application is a resource now, and re-declaring one is a lockout.**
`Access.Application`'s reconcile observes only by a persisted `applicationId`,
so a fresh logical id against a live hostname plans a blind `create` — and
Cloudflare accepts a _second_ application on the same domain with a new `aud`.
Getting here meant deleting the old dashboard-managed app first. If this
resource's state is ever lost, delete the app before re-applying; do not let
alchemy create alongside it.

**`POLICY_AUD` is an `Effect`, not `access.aud.as<string>()`.** An Output-valued
binding fails the `const Bindings` constraint and `InferEnv` silently degrades to
a union of every binding type — surfacing as ~70 errors in `workers/` that never
mention the line responsible. The comment in `module.ts` has the detail.

**`drizzle-orm` is pinned to 0.45**, not the workspace catalog's 1.0. The
mailbox DO uses `drizzle(storage, { schema })`, which 1.0 replaced.

**Tailwind's `@source` for Kumo points at the repo root's `node_modules`.** It
is a filesystem glob with no package resolution behind it, so a wrong path
costs 59% of the stylesheet and still builds clean.

## Commands

    vp run platform.inbox#test    # 22 unit tests over shared/ and workers/lib/
    vp run inbox:plan             # from the repo root
