/**
 * What this person is paying for, and what it buys them.
 *
 * TWO STEPS, AND THE SPLIT IS THE POINT. The Worker answers with memberships —
 * subscription rows, nothing more — and the resolution into capabilities happens
 * HERE, in the app, out of `platform.entitlements`. Every other app in this repo
 * will do the same with its own copy of the catalogue, which is what lets one
 * add a capability without redeploying the IdP.
 *
 * The grant travels to the browser and the browser is not trusted with it: it
 * decides what to RENDER. Anything that decides what may HAPPEN resolves the
 * grant again on the server, from the same function, next to the mutation.
 */
import { createServerFn } from "@tanstack/react-start";
import { entitles, grantFor, type Grant, type Membership } from "platform.entitlements";

import { baeClient } from "./bae.server.ts";
import { requireUser } from "./server-fn-actor.ts";

export interface MembershipView {
  /**
   * The subscription currently granting, if any — so the UI can say "renews on"
   * and "your card failed". Picked with the package's own `entitles` rather than
   * a hand-rolled status check in the component: which statuses count is policy,
   * and policy restated in a UI is policy that drifts.
   */
  readonly live: Membership | null;
  /** The resolved capabilities. */
  readonly grant: Grant;
  /** What `subscription.upgrade` must be told to replace. See the RPC method. */
  readonly stripeSubscriptionId: string | null;
  /**
   * Whether this deployment can reach Stripe at all. `false` on a stage with no
   * credentials — the subscription endpoints exist and refuse, so the UI has to
   * be able to say so rather than render a button that 500s.
   */
  readonly billing: boolean;
  /**
   * Whether a completed payment can actually be confirmed here. `false` on a
   * stage with a test key but no registered webhook endpoint — checkout opens,
   * and the subscription never activates. The UI has to say so, or the stage
   * looks broken.
   */
  readonly webhooksVerifiable: boolean;
}

export const fetchMembership = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }): Promise<MembershipView> => {
    const { memberships, stripeSubscriptionId, billing, webhooksVerifiable } =
      await baeClient().getMembership({ cookie: context.cookie });
    /**
     * Read once, here, at the edge. Everything downstream is a pure function of
     * it — which is what makes the grace window and the frozen-row cutoff
     * testable at all, and what keeps a clock read out of a React render.
     */
    const now = Date.now();
    return {
      live: memberships.find((membership) => entitles(membership, now)) ?? null,
      grant: grantFor(memberships, now),
      stripeSubscriptionId,
      billing,
      webhooksVerifiable,
    };
  });
