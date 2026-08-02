import { ALCHEMY_DEV, Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { AvatarBucket } from "./backend/avatars.ts";
import { authFeatures } from "./backend/options.ts";
import AuthWorker from "./backend/worker.ts";
import { DEV_PORT, ingress } from "./ingress.ts";
import { authDefines } from "./surfaces.ts";

export class Identity extends Cloudflare.Website.Vite<Identity>()(
  "SomewhatIntelligentAuthApp",
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const local = yield* Effect.orDie(ALCHEMY_DEV);
    const { name, hostname } = ingress(stage, local);

    return {
      name,
      main: "./src/worker.ts",
      compatibility: { flags: ["nodejs_compat"] },
      env: {
        AUTH: AuthWorker,
        AVATARS: yield* AvatarBucket,
        /**
         * `VITE_`-prefixed entries are inlined into the client bundle as
         * `import.meta.env.*` literals before rolldown runs, so a surface the
         * auth server does not run is ABSENT from the bundle rather than hidden
         * in it. Derived from the same resolved options the worker runs and the
         * schema is generated from — the app cannot advertise a flow the server
         * would answer 404 for.
         */
        ...authDefines(yield* authFeatures),
      },
      dev: { port: DEV_PORT, strictPort: true },
      /**
       * The claimed hostname, and its inverse. A stage that claims a domain
       * does not also answer on workers.dev — a second public address for the
       * login is a second origin the session cookie is not scoped to.
       */
      ...(hostname === null ? {} : { domain: [hostname] }),
      url: hostname === null,
    };
  }),
) {}

export type IdentityEnv = Cloudflare.Workers.InferEnv<Identity>;
