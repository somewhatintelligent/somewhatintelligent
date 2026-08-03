# platform

The somewhatintelligent platform: Cloudflare Workers infrastructure defined in
TypeScript with [alchemy](https://alchemy.run), built and checked with
[Vite+](https://viteplus.dev).

## Layout

| Path                                               | What it is                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/platform.auth/`                              | The identity stack — Better Auth server, its D1 database, and the app  |
| `apps/platform.inbox/`                             | The mail app — Durable Object mailboxes, an agent, and an MCP endpoint |
| `apps/mezedes/`                                    | An MCP surface, an owner-only shell, and the artifacts its tools build |
| `stacks/`                                          | What deploys each app: state key, providers, adopt policy              |
| `packages/lib.better-auth-effect`                  | Better Auth's configuration surface expressed in Effect                |
| `packages/lib.better-auth-manifest`                | What a deployment has switched on, derived from the config it runs     |
| `packages/platform.names`                          | The account's fixed names — zone, production stage, IdP, team domain   |
| `packages/platform.ui`, `packages/platform.design` | Shared components and design tokens                                    |

An app declares its own resources in `module.ts` and never imports from
`stacks/` — that is what keeps a deploy dependency out of a Worker's bundle.

`Auth` is a stack of its own and deploys first. It publishes an `AuthRouting`
output — origin, auth base URL, cookie domain, feature manifest, database id —
which is the entire vocabulary another stack gets. Service bindings name
resources `Auth` owns and are not handed across a stack boundary.

## Working on it

```sh
vp install          # after pulling
vp check            # format, lint, typecheck
vp run -r test      # every workspace's tests
```

`vp check` and a [fallow](https://fallow.tools) audit both run on commit via
`vite.config.ts`'s `staged` hooks. The audit is scoped to changed files, so a
commit is gated on what it introduced rather than the standing backlog.

## Deploying

From the repo root, against a stack's entry in `stacks/`:

```sh
export ALCHEMY_STAGE=prod
bun run auth:plan                 # what would change
bun run auth:deploy
```

`auth`, `inbox`, `access` and `mezedes` each have `:plan`, `:deploy` and
`:destroy`. `bun run inbox:dev` runs the mail app locally with its bindings.

`inbox` deploys at `prod` only, and refuses anything else outright: every name it
owns is fixed — the worker, the bucket, the hostname, the zone's mail catch-all —
so a `dev_*` deploy would not make a second inbox, it would reconfigure the live
one and steal the zone's mail.

For `auth`, only `prod` claims a hostname (`accounts.somewhatintelligent.ca`);
every other stage answers on `*.workers.dev`. That is not a gap to fill in —
`workers.dev` is on the Public Suffix List, so a browser will not scope a
session cookie to it, and non-production apps have to resolve identity through
the auth server rather than through a shared cookie.

### What a deploy reports

Both UIs render the deployed Worker version in a corner, read from
`CF_VERSION_METADATA` — a `version_metadata` binding on each app's
`Website.Vite`, filled in by the runtime rather than baked into the build. The
label is the version id Cloudflare lists under the worker's deployments, so what
a browser shows resolves back to a deployment and can be handed to a rollback.
It replaced a package.json version and a `git rev-parse --short HEAD`, which
described the machine that ran the build.

### The production database

`prod` adopts the D1 database si's `guestlist` worker created, by name.
Adoption matches by name and **creates on a miss**, so a wrong name would be a
green deploy onto an empty database. `alchemy.run.ts` refuses to finish unless
the adopted id matches `PRODUCTION_DATABASE_ID`, and the resource carries a
retain policy so `alchemy destroy` leaves it standing.
