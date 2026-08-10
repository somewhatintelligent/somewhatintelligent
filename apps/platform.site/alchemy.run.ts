import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Providers";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { Layer } from "effect";

import { CommerceModule } from "platform.commerce/module";
import * as StripeDev from "platform.commerce/infrastructure/StripeDev";
import { AuthRouting, SiteModule } from "platform.site/module";

import { state } from "@swi/infra/stage/state";
import { Deployment } from "@swi/infra/stage/StandardizedStage";
import { Auth } from "platform.auth/alchemy.run";
import { PREVIEW_SCRIPTS, workerSafeStage, workersDevHost } from "platform.names";

const stripeArmed = await Effect.runPromise(StripeDev.armIfDev());

export default Alchemy.Stack(
  "PlatformCommerce",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers(), GitHub.providers()),
    state: state(),
  },
  Effect.gen(function* () {
    const auth = yield* Auth;

    /**
     * COMMERCE GETS `AuthRouting` TOO, where it used to reach `CloudflareStack`
     * for the policy and the IdP on its own. On production the operator console
     * still declares its own zone application and that path is unchanged; off
     * production it — and the media Worker beside it — verify assertions from
     * the STAGE'S shared application, which only the auth stack knows the `aud`
     * of. This is how that fact crosses the boundary.
     */
    const commerce = yield* CommerceModule.pipe(
      Effect.provideService(AuthRouting, auth),
      Alchemy.AdoptPolicy.adopt(true),
    );

    const site = yield* SiteModule.pipe(
      Effect.provideService(AuthRouting, auth),
      Alchemy.AdoptPolicy.adopt(true),
    );

    if (stripeArmed && commerce.paymentsTier === "ephemeral") {
      yield* StripeDev.forwarder(commerce.webhookUrl);
    }

    /**
     * THE PREVIEW COMMENT, posted from HERE because this is the last of the
     * four stacks whose URLs it lists — auth, mezedes and the inbox have all
     * resolved by the time CI reaches this one, so the comment appears once the
     * whole stage is up rather than announcing hostnames that 522.
     *
     * `GitHubEnv` is `undefined` outside GitHub Actions, so a local deploy
     * posts nothing. A stable logical id means each push EDITS the comment
     * rather than adding one.
     *
     * The URLs are built from `PREVIEW_SCRIPTS` rather than read off each
     * resource, because three of the five live in stacks this one does not
     * import. That is the same table those workers are named from, so the
     * comment cannot drift from what was deployed without a type error.
     */
    const gh = yield* GitHub.GitHubEnv;
    const { stage } = yield* Deployment;
    if (gh !== undefined && gh.pr !== undefined) {
      const safe = workerSafeStage(stage);
      const url = (script: string) => `https://${workersDevHost(script)}`;
      yield* GitHub.Comment("preview-comment", {
        owner: gh.owner,
        repository: gh.repository,
        issueNumber: gh.pr,
        body: Output.interpolate`
          ## preview \`${stage}\`

          Every URL below is behind ONE Cloudflare Access application, so a
          single sign-in as an account member reaches all of them.

          | unit | url |
          | --- | --- |
          | site | ${url(PREVIEW_SCRIPTS.site(safe))} |
          | auth | ${auth.origin} |
          | operator | ${commerce.operatorUrl} |
          | mezedes | ${url(PREVIEW_SCRIPTS.mezedes(safe))} |

          Built from ${gh.sha.slice(0, 7)}. From a script, send
          \`CF-Access-Client-Id\` and \`CF-Access-Client-Secret\` instead of
          signing in.
        `,
      });
    }

    return { ...commerce, site };
  }),
);
