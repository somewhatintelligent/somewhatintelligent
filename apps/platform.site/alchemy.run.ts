import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Providers";
import * as Effect from "effect/Effect";
import { Layer } from "effect";

import { CommerceModule } from "platform.commerce/module";
import * as StripeDev from "platform.commerce/infrastructure/StripeDev";
import { AuthRouting, SiteModule } from "platform.site/module";

import { state } from "@swi/infra/stage/state";
import { Auth } from "platform.auth/alchemy.run";

const stripeArmed = await Effect.runPromise(StripeDev.armIfDev());

export default Alchemy.Stack(
  "PlatformCommerce",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    state: state(),
  },
  Effect.gen(function* () {
    const auth = yield* Auth;

    // `Operator` reaches CloudflareStack itself for the policy and the IdP.
    const commerce = yield* CommerceModule.pipe(Alchemy.AdoptPolicy.adopt(true));

    const site = yield* SiteModule.pipe(
      Effect.provideService(AuthRouting, auth),
      Alchemy.AdoptPolicy.adopt(true),
    );

    if (stripeArmed && commerce.paymentsEnvironment === "dev") {
      yield* StripeDev.forwarder(commerce.webhookUrl);
    }

    return { ...commerce, site };
  }),
);
