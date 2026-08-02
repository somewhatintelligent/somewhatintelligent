# mezedes

One Cloudflare Worker. An MCP surface with three tools, a private web shell for
the owner, and a public origin that serves what the tools built.

An agent calls `create` over MCP with a set of files. The Worker installs
the dependencies, typechecks, bundles, publishes, and returns a URL that already
serves. A version that exists is a version that typechecked and built.

`SPEC.md` is the contract. Read it before changing anything.

## Setup

```sh
bun install
```

## Tests

Offline — `test/`, no network and no bindings:

```sh
bun run test
```

Live — `integ/`, the Worker running locally under workerd through alchemy's dev
harness. The wasm, the registry fetches and the language service are all real:

```sh
bun run test:integ
```

## Check

```sh
bun run check   # vp check, then fallow --fail-on-issues
bun run ready   # check, then the offline tests
```

`fallow` enforces the layering declared in `.fallowrc.json`. It is not
advisory — it runs where the typecheck runs.

## Build

```sh
bun run build
```

vite writes `dist/shell/`, which is uploaded as the Worker's static assets.

## Deploy

```sh
ALCHEMY_STAGE=prod bun run deploy
```

Builds the shell and applies `alchemy.run.ts`: the Worker, the R2 bucket, the
`Owner` Durable Object, the Worker Loader, the custom domains `mezedes.<zone>` and
`*.a.<zone>`, and the Access application on `mezedes.<zone>` only — `*.a.<zone>`
has no Access application, because artifact links are meant to be shareable.

```sh
ALCHEMY_STAGE=prod bun run destroy
```

### The one dashboard step

Everything else is declared in `alchemy.run.ts`. In Zero Trust, enable the
Cloudflare IdP as a login method on the organisation and remove One-time PIN, so
the account-member rule is the entire policy.
