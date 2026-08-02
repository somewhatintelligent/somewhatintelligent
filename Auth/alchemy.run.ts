import * as Alchemy from "alchemy";

import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";
import * as Drizzle from "alchemy/Drizzle";

import { AuthDatabase } from "./backend/database.ts";
import AuthWorker from "./backend/worker.ts";
import { Identity } from "./identity.ts";

import { AuthSchema } from "./backend/schema.ts";

export default Alchemy.Stack(
  "SomewhatIntelligentAuth",
  {
    state: Cloudflare.state(),
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
  },
  Effect.gen(function* () {
    yield* AuthSchema;
    const authDatabase = yield* AuthDatabase;
    const authWorker = yield* AuthWorker;
    const identityWorker = yield* Identity;
    return { authDatabase, authWorker, identityWorker };
  }),
).pipe(Alchemy.AdoptPolicy.adopt());
