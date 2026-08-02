import { ALCHEMY_DEV, Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { AvatarBucket } from "./backend/avatars.ts";
import AuthWorker from "./backend/worker.ts";
import { DEV_PORT, ingress } from "./ingress.ts";

export class Identity extends Cloudflare.Website.Vite<Identity>()(
  "SomewhatIntelligentAuthApp",
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    const local = yield* Effect.orDie(ALCHEMY_DEV);

    return {
      name: ingress(stage, local).name,
      main: "./src/worker.ts",
      compatibility: { flags: ["nodejs_compat"] },
      env: { AUTH: AuthWorker, AVATARS: yield* AvatarBucket },
      assets: { runWorkerFirst: true },
      dev: { port: DEV_PORT, strictPort: true },
    };
  }),
) {}

export type IdentityEnv = Cloudflare.Workers.InferEnv<Identity>;
