import * as Cloudflare from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy";
import { Database } from "better-auth-effect";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { AuthDatabase } from "./database.ts";
import { AUTH_COOKIE_DOMAIN, AUTH_ORIGIN, Origin, UNRESOLVED_ORIGIN } from "./origin.ts";
import { AuthSecret } from "./secret.ts";

export const dialect = "sqlite" as const;

type Tag<S> = Context.Key<any, S>;

const tripwire = <S>(key: string, known: Partial<S>): S =>
  new Proxy(
    (): never => {
      throw new Error(`${key} was CALLED during schema generation; the stand-in cannot answer.`);
    },
    {
      get: (_target, property): unknown => {
        if (property in known) return known[property as keyof S];
        throw new Error(
          `${key}.${String(property)} was read during schema generation. ` +
            `Only presence and the fields listed alongside this stand-in are known here.`,
        );
      },
    },
  ) as S;

const inert = <S>(tag: Tag<S>, known: Partial<S> = {}): Layer.Layer<any> =>
  Layer.succeed(tag, tripwire(tag.key, known));

const uncoloured = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>): Effect.Effect<A, E> =>
  Effect.provide(effect, RuntimeContext.phantom);

/** A capability because `authConfig` also resolves on the deploy host, where there is no store to read. */
export class Signing extends Context.Service<Signing, { readonly secret: string }>()(
  "Auth/Signing",
) {}

/**
 * Never signs anything. The deploy host resolves `authConfig` too — for the
 * schema and the manifest.
 *
 * Every guard below reads `globalThis.__ALCHEMY_RUNTIME__` LITERALLY. The
 * bundler's define is textual (`Bundle.ts`'s `ALCHEMY_DEFINE`), so that exact
 * expression folds to `true` in the deployed Worker and the plan-only branch is
 * eliminated. Behind a helper — `runtime()` — nothing folds and these
 * stand-ins ship to production.
 */
const UNSIGNED = { secret: "schema-generation-only" } as const;

export const live = Layer.mergeAll(
  Layer.effect(
    Signing,
    Effect.gen(function* () {
      // The impl runs at Init in BOTH phases, and on the deploy host there is
      // no store binding to read — `raw.get` on `undefined`. `uncoloured`
      // because the read is a runtime effect and `bae.configure` needs a string
      // one phase earlier; same discharge as D1's raw connection.
      if (!globalThis.__ALCHEMY_RUNTIME__) return UNSIGNED;
      const read = yield* Cloudflare.SecretsStore.ReadSecret(AuthSecret);
      const secret = yield* uncoloured(Effect.orDie(read));
      return { secret: Redacted.value(secret) };
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

export const inertly = Layer.mergeAll(
  inert(Database, {
    dialect,
    betterAuthDatabase: tripwire(`${Database.key}.betterAuthDatabase`, {}),
  }),
  inert(Origin, { origin: UNRESOLVED_ORIGIN, cookieDomain: null }),
  inert(Signing, UNSIGNED),
);
