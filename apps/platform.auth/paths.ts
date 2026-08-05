import * as Effect from "effect/Effect";
import { Path } from "effect/Path";

/**
 * ABSOLUTE, anchored off this file. Alchemy resolves relative props against
 * `process.cwd()`, and there is no single cwd to design for: `cd stacks/platform.auth
 * && alchemy dev` and `alchemy plan stacks/platform.auth/alchemy.run.ts` from the
 * root are both reasonable, and a package-relative or repo-relative path is wrong
 * under one of them. Anchoring makes the question not arise.
 *
 * The cost is that persisted props carry this machine's paths, so a checkout
 * elsewhere sees a prop diff and re-runs `drizzle-kit generate`. That is a no-op
 * when the schema snapshot is unchanged, and alchemy's own docs put an absolute
 * `path.resolve(import.meta.dirname, …)` in `rootDir`, so it is the accepted
 * trade rather than a clever one.
 */
const inPackage = (p: string): Effect.Effect<string, never, Path> =>
  /**
   * GUARDED, and this is not optional. `AuthDatabase` is yielded at RUNTIME —
   * api/worker.ts -> capabilities.ts:66 — so everything its Effect does runs
   * inside the deployed Worker too. `import.meta.dirname` is undefined there,
   * and `path.resolve(undefined, …)` throws
   * `The "paths[0]" argument must be of type string`, which takes the whole
   * Worker down at init.
   *
   * `__ALCHEMY_RUNTIME__` is the flag alchemy's bundler folds to `true` in every
   * runtime artifact, precisely so plan-only work can be eliminated from a
   * deployed bundle. The resolved value is never read at runtime — it feeds
   * Drizzle codegen and the D1's migrationsDir, both plan-time — so returning
   * the unresolved string there is correct rather than a fallback.
   */
  globalThis.__ALCHEMY_RUNTIME__
    ? Effect.succeed(p)
    : Effect.map(Path, (path) => path.resolve(import.meta.dirname, p));

/** The generated Drizzle schema: a `Drizzle.Schema` prop and the schema Action's target. */
export const schemaPath = inPackage("api/schema.gen.ts");

/** Where `drizzle-kit generate` writes, and what the D1's `migrationsDir` reads. */
export const migrationsDir = inPackage("api/migrations");

/**
 * The generated file's name as the Better Auth generator should report it.
 * A LABEL, not a location — `generateSchema` only echoes it back as
 * `fileName`, which is discarded, and this file is written by the Action using
 * {@link schemaPath}. Kept relative and requirement-free so `render` can stay
 * an `Effect.runSync(Effect.cached(...))` at module scope.
 */
export const SCHEMA_FILE = "api/schema.gen.ts";
