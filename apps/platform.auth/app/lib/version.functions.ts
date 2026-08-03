/**
 * The deployed version, as the browser sees it.
 *
 * Same shape as `session.functions.ts` and for the same reason: it reaches no
 * backend, it reads back the request context the Worker boundary already wrote
 * from `env.CF_VERSION_METADATA`. Top level because the Start compiler
 * AST-extracts each handler into its own module, keyed on the declaration.
 *
 * Call it through `appVersion()` in `./version.ts`, not directly — the root's
 * `beforeLoad` runs on every navigation and this answer never changes.
 */
import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";

import type { AppVersion } from "./version.ts";

export const loadVersion = createServerFn({ method: "GET" }).handler(() => {
  const context = getGlobalStartContext() as { version?: AppVersion } | undefined;
  return context?.version ?? null;
});
