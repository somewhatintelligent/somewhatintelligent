import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Schema";
import * as Effect from "effect/Effect";

export const schemaPath = "./backend/schema.gen.ts";
export const AuthDatabase = Effect.gen(function* () {
  const migrations = yield* Drizzle.Schema("AuthMigrations", {
    schema: schemaPath,
    out: "./backend/migrations",
    dialect: "sqlite",
  });

  return yield* Cloudflare.D1.Database("AuthDatabase", {
    migrationsDir: migrations.out,
    migrationsTable: "drizzle_migrations",
  });
});
