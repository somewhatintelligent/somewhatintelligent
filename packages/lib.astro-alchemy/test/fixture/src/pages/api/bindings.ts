// Import the NARROW runtime entry, never the `alchemy/Cloudflare` barrel:
// the barrel pulls in node:os and friends, which breaks `astro dev` with
// "Failed to load url os".
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";
import type { APIRoute } from "astro";
// Astro v6+ removed `Astro.locals.runtime.env`; bindings come from workerd.
import { env as rawEnv } from "cloudflare:workers";
import type ApiWorker from "../../../infra/ApiWorker.ts";
import type { SiteEnv } from "../../../infra/site.ts";

export const prerender = false;

// Fully typed by `InferEnv<typeof Site>` — no hand-written Env interface.
const env = rawEnv as unknown as SiteEnv;

/**
 * Probes are INDEPENDENT on purpose.
 *
 * These bindings do not all work in every mode — under `alchemy dev` the
 * service binding into Alchemy's local Worker does not resolve. When every
 * probe shared one un-caught async body, that single failure threw before KV
 * or R2 were ever written, so the route answered a bare `500` and the other
 * five working bindings were indistinguishable from broken ones.
 *
 * Now each probe reports itself. A caller asserting on `kv` gets a real answer
 * regardless of what `serviceFetch` did, and anything that failed says why in
 * `errors` instead of collapsing into an opaque status code.
 */
const probe = async <T>(
  key: string,
  errors: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T | null> => {
  try {
    return await fn();
  } catch (e) {
    errors[key] = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return null;
  }
};

export const GET: APIRoute = async () => {
  const errors: Record<string, string> = {};

  const kv = await probe("kv", errors, async () => {
    await env.CACHE.put("probe", "kv-ok");
    return env.CACHE.get("probe");
  });

  const r2 = await probe("r2", errors, async () => {
    await env.UPLOADS.put("probe.txt", "r2-ok");
    return (await env.UPLOADS.get("probe.txt"))?.text() ?? null;
  });

  // option 1 — plain service-binding fetch
  const serviceFetch = await probe("serviceFetch", errors, async () =>
    (await env.API.fetch("https://api/x")).json(),
  );

  // option 2 — typed RPC into the Effect Worker. Effect methods surface as
  // promises; no Effect runtime needed here.
  const rpcGreet = await probe("rpcGreet", errors, async () =>
    toRpcAsync<typeof ApiWorker>(env.API).greet("astro"),
  );

  // Reads R2 through the Effect worker's capability layer, which this
  // (non-Effect, un-bundled-by-alchemy) entry cannot use directly.
  const rpcReadUpload = await probe("rpcReadUpload", errors, async () =>
    toRpcAsync<typeof ApiWorker>(env.API).readUpload("probe.txt"),
  );

  return new Response(
    JSON.stringify({
      bindingNames: Object.keys(env).sort(),
      kv,
      r2,
      serviceFetch,
      rpcGreet,
      rpcReadUpload,
      plainVar: env.GREETING ?? null,
      errors,
    }),
    { headers: { "content-type": "application/json" } },
  );
};
