import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen.ts";
import type { IdentitySession } from "./lib/session.ts";

/**
 * What every route can read without a fetch.
 *
 * `session` is seeded by the root route's `beforeLoad`, which reads it back out
 * of the request context the Worker boundary wrote — so a route renders an
 * identity without re-resolving one.
 *
 * It is `IdentitySession | null` and never `undefined`, which is a distinction
 * the dashboard gate depends on: null means "definitely nobody", and there is no
 * third state for "not known yet" on the server side.
 */
export interface RouterContext {
  session: IdentitySession | null;
  environment?: "development" | "staging" | "production";
}

/**
 * Root-mounted on its own hostname, so there is no basepath and no mount
 * rewrite: route paths are the URL paths. si's identity app was mounted at
 * `/account` of a shared host and carried a whole module of path rewriting for
 * it; none of that is here.
 *
 * `defaultPreloadStaleTime: 0` makes an intent preload always refetch. A hover
 * over "Sessions" should not show a cache of the sessions as they were before
 * the one you just revoked.
 */
export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultViewTransition: true,
    context: {
      session: null,
      environment: "production",
    } satisfies RouterContext,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
