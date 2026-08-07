import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Config from "effect/Config";

import { guardStage } from "./StandardizedStage.ts";

const DotenvxSecrets = Effect.gen(function* () {
  const production = yield* Config.redacted("DOTENV_PRIVATE_KEY_PRODUCTION");
  const development = yield* Config.redacted("DOTENV_PRIVATE_KEY_DEVELOPMENT");
  return { production, development };
});

export default Alchemy.Stack(
  "github",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    yield* guardStage("production");
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const apiToken = yield* Cloudflare.ApiToken.AccountApiToken("CIToken", {
      accountId,
      policies: [
        {
          effect: "allow",
          permissionGroups: [
            "Secrets Store Write",
            "Workers Scripts Write",
            "Workers KV Storage Write",
            "Workers R2 Storage Write",
            "D1 Write",
            "Queues Write",
            "Pages Write",
            "Account Settings Write",
            "Workers Tail Read",
          ],
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*",
          },
        },
      ],
    });
    const { production, development } = yield* DotenvxSecrets;
    yield* Effect.all(
      Object.entries({
        CLOUDFLARE_ACCOUNT_ID: Redacted.make(accountId),
        CLOUDFLARE_API_TOKEN: apiToken.value,
        DOTENVX_PRIVATE_KEY_PRODUCTION: production,
        DOTENVX_PRIVATE_KEY_DEVELOPMENT: development,
      }).map(([name, value]) =>
        GitHub.Secret(name, {
          owner: "somewhatintelligent",
          repository: "somewhatintelligent",
          name,
          value,
        }),
      ),
    );
  }),
);
