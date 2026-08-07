import * as Alchemy from "alchemy";
import { Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { PRODUCTION_STAGE, workerSafeStage } from "platform.names";

/** The bucket the live avatars are already in, frozen from when the stage was `prod`. */
const PRODUCTION_AVATARS_BUCKET = "si-avatars-prod";

export const AvatarBucket = Effect.gen(function* () {
  const { stage } = yield* Stack;
  const production = stage === PRODUCTION_STAGE;
  return yield* Cloudflare.R2.Bucket("AuthAvatars", {
    name: production ? PRODUCTION_AVATARS_BUCKET : `si-avatars-${workerSafeStage(stage)}`,
  }).pipe(Alchemy.RemovalPolicy.retain(production));
});
