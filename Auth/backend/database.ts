import * as Alchemy from "alchemy";
import { Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Schema";
import * as Effect from "effect/Effect";

import { PRODUCTION_STAGE } from "../ingress.ts";

export const schemaPath = "./backend/schema.gen.ts";

/**
 * The database production has always used, carried over from si's `guestlist`
 * worker rather than stood up fresh. Every account, session, passkey and
 * organization that exists lives in it.
 */
export const PRODUCTION_DATABASE_NAME = "guestlist-production-db";

/**
 * What {@link PRODUCTION_DATABASE_NAME} must resolve to.
 *
 * Alchemy adopts a D1 database BY NAME — `precreate` derives the name, lists
 * databases, and takes the one that matches. There is no id input, so this is
 * not something the deploy can be told; it is the answer the name has to give.
 *
 * It is recorded because of HOW adoption fails. A name matching nothing is not
 * an error — the database is CREATED — so a wrong name here does not stop a
 * production deploy, it silently points production at an empty database and
 * signs every existing user out. The stack publishes the adopted id as an
 * output for this reason: on the first production deploy, check it against
 * this constant before anything reaches a user.
 *
 * From si's `workers/guestlist/wrangler.jsonc`, `env.production`.
 */
export const PRODUCTION_DATABASE_ID = "2a7c2bcd-90a7-410f-a17c-895397f1e40a";

export const AuthDatabase = Effect.gen(function* () {
  const { stage } = yield* Stack;
  const production = stage === PRODUCTION_STAGE;

  const migrations = yield* Drizzle.Schema("AuthMigrations", {
    schema: schemaPath,
    out: "./backend/migrations",
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
     * own default and wrangler-compatible, so one history lives in one place
     * and si's rows stay as the record of how that schema got there.
     */
    migrationsTable: "d1_migrations",
  }).pipe(
    /**
     * `retain` in production and nowhere else. `alchemy destroy` on that stage
     * — or dropping this resource from the stack — then leaves the database
     * standing instead of deleting it. A deleted D1 has no undo, and this is
     * the one database here whose contents cannot be regenerated.
     */
    Alchemy.RemovalPolicy.retain(production),
  );
});
