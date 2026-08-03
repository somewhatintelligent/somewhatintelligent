import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { SiteModule } from "platform.site/module";

/**
 * `"SomewhatIntelligentSite"` is the state key — state is keyed by stack name
 * and stage, so changing it strands everything the old name owns.
 *
 * No typed handle in an `index.ts` beside this file: nothing downstream
 * consumes the site's outputs, and a contract with no reader is a guess about
 * the future rather than a fact about today.
 *
 * No adopt policy either. Every name here is derived by alchemy from the stack
 * and stage, so there is nothing pre-existing to take over — a deploy at a new
 * stage creates its own worker and nothing else's.
 */
export default Alchemy.Stack(
  "SomewhatIntelligentSite",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    return yield* SiteModule;
  }),
);
