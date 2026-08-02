/**
 * The session, as the browser sees it.
 *
 * `loadSession` reaches no backend — it reads back the request context the
 * Worker boundary already wrote, which is the two-hop path from the service
 * binding to a component. No route resolves a session itself, so there is
 * exactly one place that decides who the caller is.
 *
 * `loadProviders` asks the auth server which social sign-in buttons exist. It
 * takes no cookie and returns nothing but four booleans: it is the one method
 * here with no credential, deliberately, because "does a Google button appear"
 * is not a secret and asking must work before anyone has signed in.
 *
 * ## Why these are top-level `createServerFn` calls
 *
 * The Start compiler AST-extracts each handler into its own module, keyed on the
 * declaration. That is also why they cannot live in a shared library and be
 * re-exported: the extraction runs where the call is written.
 */
import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";

import { baeClient } from "./bae.server.ts";
import type { IdentitySession } from "./session.ts";

export const loadSession = createServerFn({ method: "GET" }).handler(() => {
  const context = getGlobalStartContext() as
    | { session?: IdentitySession | null; environment?: "development" | "staging" | "production" }
    | undefined;
  return context?.session ?? null;
});

export const loadProviders = createServerFn({ method: "GET" }).handler(async () => {
  const { social } = await baeClient().getProviders();
  return social;
});

/** Which social sign-in buttons to draw. All false until credentials exist. */
export type SocialProviders = Awaited<ReturnType<typeof loadProviders>>;
