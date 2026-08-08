/**
 * What this person is paying for, and what it buys them.
 *
 * TWO STEPS, AND THE SPLIT IS THE WHOLE POINT. The Worker answers with
 * memberships — subscription rows, nothing more — and the resolution into
 * capabilities happens HERE, in the app, out of `platform.entitlements`. Every
 * other app in this repo will do the same with its own copy of the catalogue,
 * which is what lets one add a capability without redeploying the IdP.
 *
 * The grant travels to the browser and the browser is not trusted with it: it
 * decides what to RENDER. Anything that decides what may HAPPEN resolves the
 * grant again on the server, from the same function, next to the mutation.
 */
import { createServerFn } from "@tanstack/react-start";
import { grantFor, type Grant, type Membership } from "platform.entitlements";

import { baeClient } from "./bae.server.ts";
import { requireUser } from "./server-fn-actor.ts";

export interface MembershipView {
  /** The rows, so the UI can say "renews on" and "your card failed". */
  readonly memberships: ReadonlyArray<Membership>;
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
}

export const fetchMembership = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }): Promise<MembershipView> => {
    const { memberships, stripeSubscriptionId, billing } = await baeClient().getMembership({
      cookie: context.cookie,
    });
    return {
      memberships,
      stripeSubscriptionId,
      /**
       * `Date.now()` is read once, here, at the edge. Everything downstream of
       * `grantFor` is a pure function of it — which is what makes the grace
       * window and the frozen-row cutoff testable at all.
       */
      grant: grantFor(memberships, Date.now()),
      billing,
    };
  });
