import { Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { workerSafeStage } from "../ingress.ts";

export const AvatarBucket = Effect.gen(function* () {
  const { stage } = yield* Stack;
  return yield* Cloudflare.R2.Bucket("AuthAvatars", {
    name: `si-avatars-${workerSafeStage(stage)}`,
  });
});
