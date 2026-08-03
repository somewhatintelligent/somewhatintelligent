import * as Effect from "effect/Effect";
import { Path } from "effect/Path";

/**
 * Where this package's real files live, split by WHO resolves the path.
 *
 * Two different answers are needed, and conflating them is a bug in either
 * direction:
 *
 * ALCHEMY RESOLVES ITS OWN PROPS, against `process.cwd()` — `Drizzle.Schema`
 * documents `schema` as "relative to the current working directory". Those
 * props are also PERSISTED and diffed (`Diff.ts` treats props as part of the
 * committed state), so an absolute path there writes a machine-specific string
 * into shared state and every other machine sees a spurious update. Alchemy
 * already guards half of this itself — it relativises the Drizzle `out`
 * ATTRIBUTE before persisting, "so that persisted state stays portable across
 * machines/checkouts" — but the `schema` PROP gets no such treatment. So
 * alchemy-facing paths stay relative, and the base they are relative to is the
 * repo root.
 *
 * WE RESOLVE OUR OWN FILESYSTEM CALLS, and those are not persisted, so they can
 * and should be anchored — a read or a write must land in this package no
 * matter where the process started.
 *
 * The invariant that makes the first half work: alchemy always runs from the
 * repo root. The deploy/plan/destroy scripts live in the root package.json and
 * pass the stack file by path, precisely so there is one cwd for every stack.
 */

/** Repo-root-relative. A `Drizzle.Schema` prop and a field of the schema Action's input — both persisted. */
export const SCHEMA_PATH = "apps/platform.auth/api/schema.gen.ts";

/** Repo-root-relative, for the same reason as {@link SCHEMA_PATH}. */
export const MIGRATIONS_DIR = "apps/platform.auth/api/migrations";

/** Repo-root-relative. Vite's root; `Website.Vite` defaults it to `process.cwd()`. */
export const PACKAGE_DIR = "apps/platform.auth";

/**
 * Resolve a repo-root-relative path absolutely WITHOUT consulting cwd, by
 * walking up from this file. For our own reads and writes, which are not
 * persisted and therefore have nothing to lose by being absolute — and
 * everything to lose by being wrong.
 */
export const fromRepoRoot = (p: string): Effect.Effect<string, never, Path> =>
  Effect.map(Path, (path) => path.resolve(import.meta.dirname, "../..", p));
