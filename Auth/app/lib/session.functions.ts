/**
 * The session, as the browser sees it.
 *
 * `loadSession` reaches no backend — it reads back the request context the
 * Worker boundary already wrote. No route resolves a session itself, so there
 * is exactly one place that decides who the caller is.
 *
 * It is a top-level `createServerFn` because the Start compiler AST-extracts
 * each handler into its own module, keyed on the declaration — which is also
 * why such handlers cannot live in a shared library and be re-exported.
 */
import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";

import type { IdentitySession } from "./session.ts";

export const loadSession = createServerFn({ method: "GET" }).handler(() => {
  const context = getGlobalStartContext() as
    | { session?: IdentitySession | null; environment?: "development" | "staging" | "production" }
    | undefined;
  return context?.session ?? null;
});
