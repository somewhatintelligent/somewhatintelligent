import * as Alchemy from "alchemy";

import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { Effect, Layer } from "effect";
import * as Drizzle from "alchemy/Drizzle";

import {
  AuthDatabase,
  PRODUCTION_DATABASE_ID,
  PRODUCTION_DATABASE_NAME,
} from "./backend/database.ts";
import { authFeatures } from "./backend/options.ts";
import { Identity } from "./identity.ts";
import { ingress, PRODUCTION_STAGE } from "./ingress.ts";
import { Auth, type AuthRouting } from "./stack.ts";

import { AuthSchema } from "./backend/schema.ts";

export default Auth.make(
  {
    state: Cloudflare.state(),
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
  },
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const local = yield* Effect.orDie(Alchemy.ALCHEMY_DEV);

    yield* AuthSchema;
    const database = yield* AuthDatabase;
    yield* Identity;

    /**
     * The routing contract is the SAME pure function the auth worker's own
     * bindings are computed from, never `identity.url`. In production the app
     * claims a hostname and has no workers.dev URL to report, and everywhere
     * else the two must agree by construction rather than by luck.
     */
    const { origin, cookieDomain } = ingress(stage, local);

    /**
     * Derived from the SAME resolved options the worker runs and the schema is
     * generated from, so the mount path published here cannot disagree with the
     * one Better Auth actually serves on — `authBaseURL` is composed from it
     * rather than restated beside it.
     */
    const features = yield* authFeatures;

    return {
      origin,
      authBaseURL: `${origin}${features.basePath}`,
      cookieDomain,
      features,
      /**
       * Adoption matches by NAME and CREATES on a miss rather than failing, so
       * a wrong name is a green deploy onto an empty database. This turns that
       * into a failed one: in production the adopted id has to be the database
       * si's `guestlist` built, and nothing else is allowed through.
       */
      databaseId: Output.map(database.databaseId, (id) => {
        if (stage === PRODUCTION_STAGE && id !== PRODUCTION_DATABASE_ID) {
          throw new Error(
            `Refusing production: adopted database ${id}, expected ${PRODUCTION_DATABASE_ID}. ` +
              `"${PRODUCTION_DATABASE_NAME}" did not resolve to the live database — this deploy ` +
              `would point production at an empty one.`,
          );
        }
        return id;
      }),
    } satisfies Alchemy.InputProps<AuthRouting>;
  }).pipe(Alchemy.AdoptPolicy.adopt()),
);
