import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { PlatformAccess } from "./index.ts";

/**
 * Account-level Access objects, and nothing else. No workers, no DNS, no
 * applications — an Access APPLICATION is per-hostname in Cloudflare's API, so
 * it belongs to whatever owns the hostname. Only policies are shareable, which
 * is why this stack is one resource.
 *
 * A SINGLETON. Deploy it at one stage and only one — `prod`, by the same
 * convention that makes prod the stage owning real things. Every consumer, at
 * every stage, pins to that one deployment:
 *
 *     const { staffPolicyId } = yield* PlatformAccess.stage[PRODUCTION_STAGE];
 *
 * A bare `yield* PlatformAccess` resolves the CURRENT stage and would find
 * nothing at `dev_stoli`.
 */
export default PlatformAccess.make(
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    /**
     * A FIXED physical name, because there is one staff policy on the account
     * and that is the whole point of it. The same policy gates a preprod
     * deployment of a public app and the prod deployment of an internal one —
     * "who counts as staff" is not a per-stage question, and a policy per stage
     * would be several answers to it that can disagree.
     *
     * Alchemy would otherwise generate `${app}-${stage}-${id}`. The default is
     * right for anything a stage owns a copy of; this is not that. The name is
     * also how the provider locates the policy for state recovery, so pinning
     * it makes the stack re-adoptable rather than duplicate-prone.
     *
     * No `adopt`: with a fixed name, a second stage attempting this fails on the
     * duplicate, which is the correct and loud outcome — it means someone
     * deployed the singleton twice.
     *
     * `cloudflareAccountMember` needs no identity provider, so this stack has
     * no dependency on auth. If SomewhatIntelligent login is ever added as a
     * second IdP, add it ALONGSIDE the account-member rule rather than instead
     * of it: a staff surface whose only IdP is auth cannot be reached when auth
     * is the thing that is broken.
     */
    const staff = yield* Cloudflare.Access.Policy("Staff", {
      name: "staff",
      decision: "allow",
      include: [{ cloudflareAccountMember: {} }],
    });

    return { staffPolicyId: staff.policyId };
  }),
);
