import * as Alchemy from "alchemy";

import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Output from "alchemy/Output";
import { Effect, Layer } from "effect";

import { AvatarBucket } from "./api/avatars.ts";
import { AuthDatabase, PRODUCTION_DATABASE_ID, PRODUCTION_DATABASE_NAME } from "./api/database.ts";
import { authFeatures } from "./api/options.ts";
import AuthWorker from "./api/worker.ts";
import { PRODUCTION_STAGE } from "platform.names";
import { DEV_PORT, ingress } from "./shared/ingress.ts";
import { authDefines } from "./shared/surfaces.ts";

import { AuthSchema } from "./api/schema.ts";

import type { AuthFeatures } from "lib.better-auth-manifest";

interface AuthRouting {
  readonly origin: string;
  readonly authBaseURL: string;
  readonly cookieDomain: string | null;
  readonly features: AuthFeatures;
  readonly databaseId: string;
}

class Identity extends Cloudflare.Website.Vite<Identity>()(
  "SomewhatIntelligentAuthApp",
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const local = yield* Effect.orDie(Alchemy.ALCHEMY_DEV);
    const { name, hostname } = ingress(stage, local);
    return {
      name,
      rootDir: import.meta.dirname,
      main: "./app/worker.ts",
      compatibility: { flags: ["nodejs_compat"] },
      env: {
        AUTH: AuthWorker,
        AVATARS: yield* AvatarBucket,
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
        ...authDefines(yield* authFeatures),
      },
      dev: { port: DEV_PORT, strictPort: true },
      ...(hostname === null ? {} : { domain: hostname }),
      workersDev: hostname === null,
    };
  }),
) {}

export type IdentityEnv = Cloudflare.Workers.InferEnv<Identity>;

export class Auth extends Alchemy.Stack<Auth, AuthRouting>()("SomewhatIntelligentAuth") {}

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
    const { origin, cookieDomain } = ingress(stage, local);
    const features = yield* authFeatures;

    return {
      origin,
      authBaseURL: `${origin}${features.basePath}`,
      cookieDomain,
      features,
      // something is fucked if the below happens and we broke prod
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
    };
  }).pipe(Alchemy.AdoptPolicy.adopt()),
);
