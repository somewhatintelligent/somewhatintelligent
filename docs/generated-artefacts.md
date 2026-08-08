# Generated artefacts, and what a fresh checkout is missing

Almost everything this repository generates is **committed**, so a clone can be
type-checked without building anything first. There is exactly one exception,
and it is worth knowing by name because its absence produces four type errors
that belong to nobody.

| Artefact                               | Produced by                               | In the repo? |
| -------------------------------------- | ----------------------------------------- | ------------ |
| `apps/*/app/routeTree.gen.ts`          | TanStack Router codegen (the Vite plugin) | committed    |
| `apps/platform.auth/api/schema.gen.ts` | `Auth/GenerateAuthSchema`, at deploy      | committed    |
| `apps/*/**/migrations/**`              | `drizzle-kit generate`, at deploy         | committed    |
| `apps/platform.site/.astro/types.d.ts` | Astro's content-collection sync           | **no**       |

## The four errors a fresh checkout reports

```
x typescript(TS7006): Parameter 'entry' implicitly has an 'any' type.
    ,-[apps/platform.site/src/pages/sitemap.xml.ts:57:43]
x typescript(TS7006): Parameter 'entry' implicitly has an 'any' type.
    ,-[apps/platform.site/src/pages/writing.md.ts:22:43]
x typescript(TS7006): Parameter 'entry' implicitly has an 'any' type.
    ,-[apps/platform.site/src/pages/writing/[slug].md.ts:31:18]
x typescript(TS7006): Parameter 'candidate' implicitly has an 'any' type.
    ,-[apps/platform.site/src/pages/writing/[slug].md.ts:44:37]
```

`apps/platform.site/tsconfig.json` declares `"include": [".astro/types.d.ts",
"**/*"]`. That file is Astro's codegen for the `writing` content collection, it
is gitignored by `apps/platform.site/.gitignore`, and **nothing in `bun install`
produces it**. Without it `getCollection("writing")` has no generated entry type,
so every `.map((entry) => …)` over its result is implicitly `any` under the
strict preset.

Generate it and `vp check` reports **0 errors**, from the repo root and from
inside the package alike:

```sh
cd apps/platform.site && bunx astro sync
```

### What it is not

Two plausible diagnoses that have been checked and are wrong:

- **Not "running checks from the monorepo root instead of the package."**
  `vp check` from inside `apps/platform.site` reports the same four. The working
  directory was never the variable.
- **Not anything a branch introduced.** The count is identical with and without
  any change in flight, because the cause is a missing file rather than a
  missing annotation. Treat a baseline of exactly these four as "this checkout
  has never synced", and compare against it rather than against zero.

## Why it is not wired into `prepare`

Three routes were tried and each is closed:

- **A `prepare` script in `apps/platform.site/package.json`.** Bun does not run
  workspace `prepare` scripts on a monorepo install — verified by adding one and
  reinstalling; nothing ran.
- **Appending `astro sync` to the root `prepare`.** This is the one that looks
  right and is the most wrong. Astro is driven **programmatically by alchemy**
  here: `Cloudflare.Website.Astro` explicitly does not read `astro.config.*`, and
  the build goes through `@distilled.cloud/astro`. Bolting the Astro CLI onto
  install would stand up a second build lever beside the alchemy one, which is
  the mistake the whole toolchain is arranged to avoid. `vite build` and
  `vite preview` do not exist in this repo for the same reason.
- **Having `@distilled.cloud/astro` emit it.** It does not, and it is not its
  job — the file is Astro's own content codegen.

So it stays a manual step for a container that has never run the stack. Anything
that provisions such a container from scratch — a CI job, an agent session —
should run the sync as part of setup rather than the repo pretending it happens
on install.
