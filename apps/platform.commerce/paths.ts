import * as Effect from "effect/Effect";
import { Path } from "effect/Path";

/**
 * ABSOLUTE, anchored off this file — the same trade `platform.auth/paths.ts`
 * makes and for the same reason. Alchemy resolves relative props against
 * `process.cwd()`, and there is no single cwd to design for: `alchemy deploy
 * stacks/platform.commerce/alchemy.run.ts` from the repo root and `bun test`
 * from inside this package are both reasonable, and a package-relative or
 * repo-relative path is wrong under one of them.
 *
 * The spike this was lifted from wrote `"./domain/Schema.ts"` and
 * `"./migrations"` because it had exactly one cwd. That stopped being true the
 * moment the stack moved to `stacks/`.
 */
const inPackage = (p: string): Effect.Effect<string, never, Path> =>
  /**
   * GUARDED, and not optional. `runtime.ts`'s `handles` resolves the database —
   * and therefore the schema resource above it — from inside every Worker's
   * request path, so this code runs in the deployed isolate too.
   * `import.meta.dirname` is undefined there and `path.resolve(undefined, …)`
   * throws `The "paths[0]" argument must be of type string`, taking the Worker
   * down at init.
   *
   * `__ALCHEMY_RUNTIME__` is the flag alchemy's bundler folds to `true` in every
   * runtime artifact, precisely so plan-only work can be eliminated. The value
   * is never read at runtime — it feeds drizzle codegen and the D1's
   * `migrationsDir`, both plan-time — so returning the unresolved string there
   * is correct rather than a fallback.
   */
  globalThis.__ALCHEMY_RUNTIME__
    ? Effect.succeed(p)
    : Effect.map(Path, (path) => path.resolve(import.meta.dirname, p));

/** The drizzle table definitions: a `Drizzle.Schema` prop. */
export const schemaPath = inPackage("domain/Schema.ts");

/** Where `drizzle-kit generate` writes, and what the D1's `migrationsDir` reads. */
export const migrationsDir = inPackage("migrations");

/**
 * Vite's root for the operator console. `Website.Vite` defaults it to
 * `process.cwd()`, which is the repo root under `alchemy deploy
 * stacks/platform.commerce/alchemy.run.ts` — and a wrong root fails at BUILD
 * rather than at plan, so no `alchemy plan` will report it.
 *
 * Not routed through `inPackage`: this is read only by `module.ts`, which never
 * reaches a bundle, so the `__ALCHEMY_RUNTIME__` guard the two above need would
 * be guarding nothing.
 */
export const PACKAGE_DIR = import.meta.dirname;
