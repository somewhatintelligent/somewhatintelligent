import * as Cloudflare from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy";
import { Database } from "better-auth-effect";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AuthDatabase } from "./database.ts";
import { Gateway, GATEWAY_ORIGIN, UNRESOLVED_ORIGIN } from "./gateway.ts";

export const dialect = "sqlite" as const;

export const columnNaming = "verbatim" as const;

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

export const live = Layer.mergeAll(
  Layer.effect(
    Database,
    Effect.gen(function* () {
      const d1 = yield* AuthDatabase;
      const connection = yield* Cloudflare.D1.QueryDatabase(d1);
      return { dialect, betterAuthDatabase: yield* uncoloured(connection.raw) };
    }),
  ),
  Layer.effect(
    Gateway,
    Effect.flatMap(Cloudflare.Workers.WorkerEnvironment, (env) => {
      const origin = env[GATEWAY_ORIGIN];
      if (typeof origin === "string" && origin !== "") return Effect.succeed({ origin });
      if ((globalThis as { __ALCHEMY_RUNTIME__?: boolean }).__ALCHEMY_RUNTIME__ === true) {
        return Effect.die(
          new Error(
            `${GATEWAY_ORIGIN} is not bound on the auth worker; every URL Better Auth mints would be wrong.`,
          ),
        );
      }
      return Effect.succeed({ origin: UNRESOLVED_ORIGIN });
    }),
  ),
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(Cloudflare.D1.QueryDatabaseBinding, Cloudflare.R2.ReadWriteBucketBinding),
  ),
);

export const inertly = Layer.mergeAll(
  inert(Database, {
    dialect,
    betterAuthDatabase: tripwire(`${Database.key}.betterAuthDatabase`, {}),
  }),
  inert(Gateway, { origin: UNRESOLVED_ORIGIN }),
);
