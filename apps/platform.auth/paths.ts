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
  Effect.map(Path, (path) => path.resolve(import.meta.dirname, p));

/** The generated Drizzle schema: a `Drizzle.Schema` prop and the schema Action's target. */
export const schemaPath = inPackage("api/schema.gen.ts");

/** Where `drizzle-kit generate` writes, and what the D1's `migrationsDir` reads. */
export const migrationsDir = inPackage("api/migrations");

/** Vite's root for the identity app. `Website.Vite` defaults it to `process.cwd()`. */
export const PACKAGE_DIR = import.meta.dirname;

/**
 * The generated file's name as the Better Auth generator should report it.
 * A LABEL, not a location — `generateSchema` only echoes it back as
 * `fileName`, which is discarded, and this file is written by the Action using
 * {@link schemaPath}. Kept relative and requirement-free so `render` can stay
 * an `Effect.runSync(Effect.cached(...))` at module scope.
 */
export const SCHEMA_FILE = "api/schema.gen.ts";
