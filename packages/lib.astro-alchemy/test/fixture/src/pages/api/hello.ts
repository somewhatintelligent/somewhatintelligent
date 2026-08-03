import type { APIRoute } from "astro";

export const prerender = false;

// Exercises: a server endpoint, per-request state, the Cloudflare request
// metadata, and a Node builtin (which only works if nodejs_compat is on — the
// stack adds that flag; the adapter emits no compatibility flags of its own).
export const GET: APIRoute = async ({ request }) => {
  const { Buffer } = await import("node:buffer");
  const url = new URL(request.url);

  return new Response(
    JSON.stringify({
      ok: true,
      nonce: crypto.randomUUID(),
      renderedAt: new Date().toISOString(),
      echo: url.searchParams.get("echo"),
      // Proves nodejs_compat is actually on — node:buffer is not in workerd core.
      nodeBuffer: Buffer.from("astro").toString("base64"),
      colo: (request as any).cf?.colo ?? null,
    }),
    { headers: { "content-type": "application/json" } },
  );
};
