import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { PRODUCTION_STAGE } from "platform.names";

import { InboxModule, StaffPolicy } from "platform.inbox/module";

import { PlatformAccess } from "../platform.access/index.ts";

/**
 * `"AgenticInbox"` is the state key — the live deployment was applied under it.
 *
 * `stage[PRODUCTION_STAGE]`, not a bare `yield*`: platform.access is a singleton
 * deployed at prod alone. The ref lives here because `apps/` may not import
 * `stacks/`; the app only states the requirement.
 *
 * `adopt(true)` because everything here already exists.
 */
export default Alchemy.Stack(
  "AgenticInbox",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const { staffPolicyId } = yield* PlatformAccess.stage[PRODUCTION_STAGE];

    return yield* InboxModule.pipe(
      Effect.provideService(StaffPolicy, { policyId: staffPolicyId }),
      Alchemy.AdoptPolicy.adopt(true),
    );
  }),
);
