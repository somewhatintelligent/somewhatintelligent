import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";

import { MezedesModule } from "mezedes/module";

/**
 * `"Mezedes"` is the state key — state is keyed by stack name and stage, so
 * changing it strands everything the old name owns. It survived being split out
 * of the app on purpose.
 *
 * No typed handle: nothing consumes a product stack's outputs, so a contract
 * here would have no reader.
 *
 * `adopt(true)` because Access applications are identified by their domain — one
 * left behind by an earlier stack on this apex is `OwnedBySomeoneElse` and stops
 * the deploy dead. It is a hand-over, not a merge: retire the previous owner, or
 * its `destroy` deletes a resource this stack now depends on.
 */
export default Alchemy.Stack(
  "Mezedes",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  MezedesModule.pipe(Alchemy.AdoptPolicy.adopt(true)),
);
