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

    // The same pure function the auth worker's own bindings come from, never
    // `identity.url`: in production the app claims a hostname and has no
    // workers.dev URL to report.
    const { origin, cookieDomain } = ingress(stage, local);

    // The same resolved options the worker runs and the schema is generated
    // from, so `authBaseURL` is composed from the real mount path rather than
    // restated beside it.
    const features = yield* authFeatures;

    return {
      origin,
      authBaseURL: `${origin}${features.basePath}`,
      cookieDomain,
      features,
      /**
       * Adoption matches by NAME and CREATES on a miss, so a wrong name is a
       * green deploy onto an empty database. This turns that into a failed one.
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
