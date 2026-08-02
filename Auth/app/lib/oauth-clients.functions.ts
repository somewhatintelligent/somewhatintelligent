import { createServerFn } from "@tanstack/react-start";
import { baeClient } from "@/lib/bae.server";

export const resolveClientName = createServerFn({ method: "POST" })
  .validator((data: { client_id: string; oauth_query: string }) => data)
  .handler(async ({ data }) => {
    const res = await baeClient().publicClientPrelogin({
      client_id: data.client_id,
      oauth_query: data.oauth_query,
    });
    return res.ok ? ((res.value as { client_name?: string }).client_name ?? null) : null;
  });
