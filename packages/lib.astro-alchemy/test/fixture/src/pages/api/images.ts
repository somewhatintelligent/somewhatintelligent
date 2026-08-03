import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

// Only the stack decides what is bound on the deployed Worker, so this proves
// whether an IMAGES binding is actually present — it is absent unless `env`
// declares one, regardless of what the adapter asks for.
export const GET: APIRoute = async () => {
  const images = (env as any).IMAGES;
  return new Response(
    JSON.stringify({
      present: images !== undefined,
      type: typeof images,
      hasInput: typeof images?.input === "function",
    }),
    { headers: { "content-type": "application/json" } },
  );
};
