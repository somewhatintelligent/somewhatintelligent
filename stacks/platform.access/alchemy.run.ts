import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { PlatformAccess } from "./index.ts";

/**
 * Account-level Access objects, and nothing else. No workers, no DNS, no
 * applications — an Access APPLICATION is per-hostname in Cloudflare's API, so
 * it belongs to whatever owns the hostname. Only policies are shareable, which
 * is why this stack is one resource.
 *
 * Depends on nothing, so it can deploy first or last.
 */
export default PlatformAccess.make(
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    /**
     * `name` omitted so alchemy derives a per-stage physical name — a shared
     * literal would have two stages contending for one account-level object,
     * which is the same reason Mezedes omits it on its own policy today.
     *
     * `cloudflareAccountMember` needs no identity provider, so this stack has
     * no dependency on auth. If SomewhatIntelligent login is ever added as a
     * second IdP, add it ALONGSIDE the account-member rule rather than instead
     * of it: a staff surface whose only IdP is auth cannot be reached when auth
     * is the thing that is broken.
     */
    const staff = yield* Cloudflare.Access.Policy("Staff", {
      decision: "allow",
      include: [{ cloudflareAccountMember: {} }],
    });

    return { staffPolicyId: staff.policyId };
  }),
);
