import { Random, Stack } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { SANDBOX } from "@swi/infra/stage/sandbox";
import { PRODUCTION_STAGE, workerSafeStage } from "platform.names";

/**
 * What Better Auth signs every session cookie and JWT with. Unset, it falls
 * back to a constant compiled into the package that anyone can read.
 *
 * `Random` persists the value in stack state, so replacing this resource
 * invalidates every live session.
 *
 * `None` UNDER `SANDBOX`, and the decision belongs here rather than at the
 * consumer: the store is account-level and Secrets Store has no local provider,
 * so this is the one resource in the graph that reaches the account even when
 * everything around it is a workerd simulator. A stage with no standing to
 * write there must not declare it, and a caller holding `None` cannot
 * accidentally bind what was never created.
 *
 * What that costs is the real key. Every caller signs with `UNSIGNED` instead,
 * so a session minted in a sandbox is not one a deployed stage will accept —
 * which is the correct relationship between the two, not a limitation to work
 * around.
 */
export const AuthSecret = Effect.gen(function* () {
  if (yield* Effect.orDie(SANDBOX)) return Option.none();

  const { stage } = yield* Stack;
  const production = stage === PRODUCTION_STAGE;
  const store = yield* Cloudflare.SecretsStore.Store("AuthSecrets");
  const value = yield* Random("BetterAuthSecretValue");

  return Option.some(
    yield* Cloudflare.SecretsStore.Secret("BetterAuthSecret", {
      store,
      value: value.text,
      // One store per ACCOUNT, so the name is all that keeps stages apart: without
      // the suffix, whichever stage deploys last owns production's signing key.
      name: production ? "BetterAuthSecret" : `BetterAuthSecret-${workerSafeStage(stage)}`,
    }),
  );
});
