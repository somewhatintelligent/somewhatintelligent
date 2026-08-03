import { ALCHEMY_DEV, RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { Database } from "lib.better-auth-effect";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { AuthDatabase } from "./database.ts";
import * as generated from "./schema.gen.ts";
import { AUTH_COOKIE_DOMAIN, AUTH_ORIGIN, Origin, UNRESOLVED_ORIGIN } from "./origin.ts";
import { AuthSecret } from "./secret.ts";

export const dialect = "sqlite" as const;

/**
 * The generated tables, minus the relations export, because Better Auth's
 * `schema` is a model-name -> table map and `relations` is neither.
 *
 * Splitting them here rather than enumerating the tables keeps this correct
 * when `schema.gen.ts` is regenerated with a new model.
 */
const { relations, ...schema } = generated;

/**
 * Discharge `RuntimeContext` from a binding read. The context is present at
 * runtime but absent from the type, and `bae.configure` needs a plain value one
 * phase earlier — the same discharge D1's raw connection uses.
 */
const uncoloured = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>): Effect.Effect<A, E> =>
  Effect.provide(effect, RuntimeContext.phantom);

/** A capability because `authConfig` also resolves on the deploy host, where there is no store to read. */
export class Signing extends Context.Service<Signing, { readonly secret: string }>()(
  "Auth/Signing",
) {}

/** Stands in on the deploy host, which resolves `authConfig` for the schema and the manifest. */
export const UNSIGNED = { secret: "schema-generation-only" } as const;

/**
 * Every guard below reads `globalThis.__ALCHEMY_RUNTIME__` LITERALLY. The
 * bundler's define is textual (`Bundle.ts`'s `ALCHEMY_DEFINE`), so that exact
 * expression folds to `true` in the deployed Worker and the deploy-host branch
 * is eliminated. Behind a helper — `runtime()` — nothing folds and these
 * stand-ins ship to production.
 */
export const live = Layer.mergeAll(
  Layer.effect(
    Signing,
    Effect.gen(function* () {
      /**
       * `ReadSecret` DECLARES the binding, on the deploy host only. Local dev
       * declares none and signs with the stand-in — workerd rejects a
       * `secrets_store_secret` binding outright — but still yields `AuthSecret`
       * so the shared, account-level secret stays in the graph rather than
       * being deleted as an orphan.
       */
      if (!globalThis.__ALCHEMY_RUNTIME__) {
        if (yield* Effect.orDie(ALCHEMY_DEV)) return yield* Effect.as(AuthSecret, UNSIGNED);
        yield* Cloudflare.SecretsStore.ReadSecret(AuthSecret);
        return UNSIGNED;
      }

      const secret = yield* AuthSecret;
      const env = yield* Cloudflare.Workers.WorkerEnvironment;
      if (env[secret.LogicalId] === undefined) return UNSIGNED;

      const read = yield* Cloudflare.SecretsStore.ReadSecret(AuthSecret);
      return { secret: Redacted.value(yield* uncoloured(Effect.orDie(read))) };
    }),
  ),
  Layer.effect(
    Database,
    Effect.gen(function* () {
      const d1 = yield* AuthDatabase;
      const connection = yield* Cloudflare.D1.QueryDatabase(d1);
      const raw = yield* uncoloured(connection.raw);

      /**
       * THROUGH THE GENERATED SCHEMA, not the raw binding.
       *
       * Handing Better Auth a bare D1 makes it use its built-in Kysely adapter,
       * which names columns in camelCase. `api/schema.ts` deliberately generates
       * snake_case — production came from si's `guestlist` and every column in
       * it is snake_case — so the two halves disagreed and every query failed
       * with `table verification has no column named expiresAt`. The migrations
       * were right; nothing read them.
       *
       * Going through `drizzleAdapter` makes the column names come from the same
       * file the migrations do, so there is one source rather than two
       * conventions that happen to agree until they do not.
       */
      return {
        dialect,
        betterAuthDatabase: drizzleAdapter(drizzle(raw, { relations }), {
          provider: dialect,
          schema,
        }),
      };
    }),
  ),
  Layer.effect(
    Origin,
    Effect.flatMap(Cloudflare.Workers.WorkerEnvironment, (env) => {
      const domain = env[AUTH_COOKIE_DOMAIN];
      const cookieDomain = typeof domain === "string" && domain !== "" ? domain : null;
      const origin = env[AUTH_ORIGIN];
      if (typeof origin === "string" && origin !== "")
        return Effect.succeed({ origin, cookieDomain });
      if (globalThis.__ALCHEMY_RUNTIME__) {
        return Effect.die(
          new Error(
            `${AUTH_ORIGIN} is not bound on the auth worker; every URL Better Auth mints would be wrong.`,
          ),
        );
      }
      return Effect.succeed({ origin: UNRESOLVED_ORIGIN, cookieDomain });
    }),
  ),
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Cloudflare.D1.QueryDatabaseBinding,
      Cloudflare.R2.ReadWriteBucketBinding,
      Cloudflare.SecretsStore.ReadSecretBinding,
    ),
  ),
);
