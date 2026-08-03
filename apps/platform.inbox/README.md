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

**The Access application is dashboard-managed**, and its `aud` is a literal in
`module.ts`. Declaring it as a resource would create a _second_ application on
the same hostname with a fresh `aud`, which locks everyone out. The reasoning,
and the alchemy source it was verified against, are in the comment there.

**`drizzle-orm` is pinned to 0.45**, not the workspace catalog's 1.0. The
mailbox DO uses `drizzle(storage, { schema })`, which 1.0 replaced.

**Tailwind's `@source` for Kumo points at the repo root's `node_modules`.** It
is a filesystem glob with no package resolution behind it, so a wrong path
costs 59% of the stylesheet and still builds clean.

## Commands

    vp run platform.inbox#test    # 22 unit tests over shared/ and workers/lib/
    vp run inbox:plan             # from the repo root
