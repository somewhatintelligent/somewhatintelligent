import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import type { OperatorActor } from "../domain/Contracts.ts";
import { routeTree } from "./routeTree.gen.ts";

/**
 * The resolved Access actor for this request, seeded by the root route's
 * `beforeLoad` from the request context `worker.ts` wrote. Route components
 * render who they are without re-verifying anything.
 */
export interface RouterContext {
  actor: OperatorActor | null;
}

/**
 * Root-mounted on its own hostname — `desk.<zone>`, see `Hostnames` in
 * `module.ts` — so there is no basepath and no mount rewrite. Route paths live
 * at the app root.
 */
export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    /**
     * Zero, not the default. This console is a view onto state a payment
     * provider and a cron are both mutating behind the operator's back — a
     * preloaded order list that is thirty seconds stale is worse than a
     * momentary spinner, because it reads as current.
     */
    defaultPreloadStaleTime: 0,
    defaultViewTransition: true,
    context: { actor: null } satisfies RouterContext,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
