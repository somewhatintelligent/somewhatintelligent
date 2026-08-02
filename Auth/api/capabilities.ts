import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Database } from "better-auth-effect";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { AuthDatabase } from "./database.ts";
import { AUTH_COOKIE_DOMAIN, AUTH_ORIGIN, Origin, UNRESOLVED_ORIGIN } from "./origin.ts";
import { AuthSecret } from "./secret.ts";

export const dialect = "sqlite" as const;

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
       * `ReadSecret` is what DECLARES the binding, and it does so only on the
       * deploy host — so it has to be called before the guard, in both phases.
       * Reading the value is the runtime-only half: at plan time there is no
       * store behind the binding and `.get()` would run on `undefined`.
       */
      const read = yield* Cloudflare.SecretsStore.ReadSecret(AuthSecret);
      if (!globalThis.__ALCHEMY_RUNTIME__) return UNSIGNED;
      return { secret: Redacted.value(yield* uncoloured(Effect.orDie(read))) };
    }),
  ),
  Layer.effect(
    Database,
    Effect.gen(function* () {
      const d1 = yield* AuthDatabase;
      const connection = yield* Cloudflare.D1.QueryDatabase(d1);
      return { dialect, betterAuthDatabase: yield* uncoloured(connection.raw) };
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
