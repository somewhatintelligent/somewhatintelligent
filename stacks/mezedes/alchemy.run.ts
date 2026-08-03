import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { PRODUCTION_STAGE } from "platform.names";

import { MezedesModule, StaffPolicy } from "mezedes/module";

import { PlatformAccess } from "../platform.access/index.ts";

/**
 * `"Mezedes"` is the state key — state is keyed by stack name and stage, so
 * changing it strands everything the old name owns.
 *
 * No typed handle: nothing consumes a product stack's outputs.
 *
 * `stage[PRODUCTION_STAGE]`, not a bare `yield*`: platform.access is a singleton
 * deployed at prod alone, so every stage of this app pins to that one. The ref
 * lives here because `apps/` may not import `stacks/`.
 *
 * `adopt(true)` because Access applications are identified by their domain — one
 * left behind by an earlier stack on this apex is `OwnedBySomeoneElse` and stops
 * the deploy dead.
 */
export default Alchemy.Stack(
  "Mezedes",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const { staffPolicyId } = yield* PlatformAccess.stage[PRODUCTION_STAGE];

    return yield* MezedesModule.pipe(
      Effect.provideService(StaffPolicy, { policyId: staffPolicyId }),
      Alchemy.AdoptPolicy.adopt(true),
    );
  }),
);
