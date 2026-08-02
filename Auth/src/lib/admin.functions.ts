/**
 * Only the reads. Every admin MUTATION — create, ban, set role, set password,
 * revoke — goes browser-direct through `authClient.admin.*` and the same-origin
 * `/api/auth` proxy. Routing them through a server function would add a hop and
 * a second copy of the authorization decision.
 */
import { createServerFn } from "@tanstack/react-start";

import { baeClient } from "./bae.server.ts";
import { requireAdmin } from "./server-fn-actor.ts";

export const getStats = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const res = await baeClient().adminStats({ cookie: context.cookie });
    if (!res.ok) throw new Error(res.error);
    return res;
  });

export const getApiKeys = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const res = await baeClient().adminListApiKeys({ cookie: context.cookie });
    if (!res.ok) throw new Error(res.error);
    return { apiKeys: res.apiKeys };
  });
