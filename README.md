# platform

The somewhatintelligent platform: Cloudflare Workers infrastructure defined in
TypeScript with [alchemy](https://alchemy.run), built and checked with
[Vite+](https://viteplus.dev).

## Layout

| Path                              | What it is                                                             |
| --------------------------------- | ---------------------------------------------------------------------- |
| `apps/platform.auth/`             | The identity stack — Better Auth server, its D1 database, and the app  |
| `apps/mezedes/`                   | An MCP surface, an owner-only shell, and the artifacts its tools build |
| `packages/lib.better-auth-effect` | Better Auth's configuration surface expressed in Effect                |
| `packages/better-auth-manifest`   | What a deployment has switched on, derived from the config it runs     |
| `packages/ui`, `packages/design`  | Shared components and design tokens                                    |

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

From `apps/platform.auth/`:

```sh
bun run plan --stage <stage>      # what would change
bun run deploy --stage <stage>
```

Only `prod` claims a hostname (`accounts.somewhatintelligent.ca`); every other
stage answers on `*.workers.dev`. That is not a gap to fill in — `workers.dev`
is on the Public Suffix List, so a browser will not scope a session cookie to
it, and non-production apps have to resolve identity through the auth server
rather than through a shared cookie.

### The production database

`prod` adopts the D1 database si's `guestlist` worker created, by name.
Adoption matches by name and **creates on a miss**, so a wrong name would be a
green deploy onto an empty database. `alchemy.run.ts` refuses to finish unless
the adopted id matches `PRODUCTION_DATABASE_ID`, and the resource carries a
retain policy so `alchemy destroy` leaves it standing.
