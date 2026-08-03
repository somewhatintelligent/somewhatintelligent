import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { AuthRouting, SiteModule } from "platform.site/module";

import { Auth } from "../platform.auth/index.ts";

export default Alchemy.Stack(
  "SomewhatIntelligentSite",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const auth = yield* Auth;

    return yield* SiteModule.pipe(Effect.provideService(AuthRouting, { origin: auth.origin }));
  }),
);
