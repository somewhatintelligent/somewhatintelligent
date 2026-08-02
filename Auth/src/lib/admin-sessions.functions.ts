import { createServerFn } from "@tanstack/react-start";

import { baeClient } from "@/lib/bae.server";
import { requireAdmin } from "@/lib/server-fn-actor";

export const getSessions = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const res = await baeClient().adminListSessions({ cookie: context.cookie });
    if (!res.ok) throw new Error(res.error);
    return { sessions: res.sessions };
  });
