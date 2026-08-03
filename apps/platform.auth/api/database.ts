import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Schema";
import * as Effect from "effect/Effect";

import { MIGRATIONS_DIR, SCHEMA_PATH } from "../paths.ts";
import { PRODUCTION_STAGE } from "../shared/ingress.ts";

/**
 * The database production has always used, carried over from si's `guestlist`
 * worker rather than stood up fresh. Every account, session, passkey and
 * organization that exists lives in it.
 */
export const PRODUCTION_DATABASE_NAME = "guestlist-production-db";

/**
 * What {@link PRODUCTION_DATABASE_NAME} must resolve to, from si's
 * `workers/guestlist/wrangler.jsonc`.
 *
 * Alchemy adopts BY NAME and there is no id input, so this is not something the
 * deploy can be told — it is the answer the name has to give. It is recorded
 * because of how adoption fails: a name matching nothing is not an error, the
 * database is CREATED, so a wrong name silently points production at an empty
 * one and signs every user out. `alchemy.run.ts` checks the adopted id against
 * this before the deploy is allowed to finish.
 */
export const PRODUCTION_DATABASE_ID = "2a7c2bcd-90a7-410f-a17c-895397f1e40a";

export const AuthDatabase = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const production = stage === PRODUCTION_STAGE;

  const migrations = yield* Drizzle.Schema("AuthMigrations", {
    /**
     * REPO-ROOT-RELATIVE, not absolute. Alchemy resolves both against
     * `process.cwd()` and PERSISTS them as props, so an absolute path here
     * would write this machine's filesystem into shared state. The invariant
     * that makes relative correct is that alchemy runs from the repo root —
     * see `../paths.ts`.
     */
    schema: SCHEMA_PATH,
    out: MIGRATIONS_DIR,
    dialect: "sqlite",
  });

  return yield* Cloudflare.D1.Database("AuthDatabase", {
    /**
     * Only production pins a name. Every other stage keeps alchemy's
     * stage-derived one, so no stage can adopt another's data.
     */
    ...(production ? { name: PRODUCTION_DATABASE_NAME } : {}),
    migrationsDir: migrations.out,
    /**
     * The table production already has, holding si's six v0 entries. Alchemy's
     * own default and wrangler-compatible, so one history lives in one place.
     */
    migrationsTable: "d1_migrations",
  }).pipe(
    /**
     * Production only. `alchemy destroy` — or dropping this resource — then
     * leaves the database standing. A deleted D1 has no undo, and this is the
     * one database here whose contents cannot be regenerated.
     */
    Alchemy.RemovalPolicy.retain(production),
  );
});
