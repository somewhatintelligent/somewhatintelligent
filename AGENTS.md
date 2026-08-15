<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Where things are written down

This file is an INDEX. Anything that needs more than a line lives in `docs/`
and is linked from here — see [`docs/README.md`](docs/README.md) for the full
list.

- [`docs/generated-artefacts.md`](docs/generated-artefacts.md) — read this
  before believing a `vp check` failure. A checkout that has never run
  `astro sync` reports four `TS7006` errors in `apps/platform.site` that no
  change introduced, and they do not go away by running the check from a
  different directory.
- [`docs/rfcs/`](docs/rfcs/) — design records for changes crossing a service, a
  schema, or a published contract. Read the relevant one before changing what it
  describes.

## Running a stack locally

`SANDBOX=1` runs a stack against local state and skips the resources it has no
standing to own, which is what lets a container without account credentials run
one — see `infra/stage/sandbox.ts`.

```sh
SANDBOX=1 CI=1 CLOUDFLARE_ACCOUNT_ID=<account> bunx alchemy dev apps/<app>/alchemy.run.ts --stage dev_<name>
```
