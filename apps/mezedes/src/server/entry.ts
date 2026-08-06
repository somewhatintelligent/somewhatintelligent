import { observe } from "@swi/infra/observe";
import { authorize, ownerKey, type AuthResult } from "./auth.ts";
import { serveArtifact } from "./serve.ts";
import { handleApi } from "./api.ts";
import { mcpHandler } from "./tools.ts";
import type { Env } from "./env.ts";

export { Owner } from "./owner.ts";

/**
 * Substituted in tests, the way `auth.ts` takes its own. Module mocking is not
 * an option: bun's is process-global, so stubbing these would corrupt the
 * suites that test them directly.
 */
export interface RouteDeps {
  readonly serveArtifact: typeof serveArtifact;
  readonly authorize: typeof authorize;
}

const LIVE: RouteDeps = { serveArtifact, authorize };

/**
 * The identity local dev runs as. `AUTH` is "none" there, so there is no token
 * to take a tenant from — a fixed one keeps the dev index and blob prefix
 * stable across restarts. It is not a bypass: under `AUTH: "access"` this is
 * never reached, because the gate answers first or refuses.
 */
const DEV_PRINCIPAL: AuthResult = { ok: true, principal: { sub: "dev", email: "dev@localhost" } };

/**
 * Artifact hosts are matched BEFORE the auth gate. They are unauthenticated by
 * design; reversing this makes every shared link demand a login.
 */
export const handle = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: RouteDeps = LIVE,
): Promise<Response> => {
  const artifact = await deps.serveArtifact(request, env);
  if (artifact) return artifact;

  // In local dev AUTH is "none", so the gate is absent from the request path
  // rather than present and declining to act.
  const decision = env.AUTH === "access" ? await deps.authorize(request, env) : DEV_PRINCIPAL;
  if (!decision.ok) return refused(decision.denial, decision.detail, request);

  /**
   * The tenant, taken from the token the gate just verified. The Access policy
   * is the only thing that says who may be here; this says nothing about who
   * that is, it only asks. Widening the policy therefore adds tenants rather
   * than sharing one.
   */
  const owner = await ownerKey(decision.principal.email);

  const url = new URL(request.url);
  if (url.pathname === "/mcp") return mcpHandler(env, owner)(request, env, ctx);
  if (url.pathname.startsWith("/api/")) return handleApi(request, env, owner);

  // Everything else is the shell: Workers static assets, SPA fallback.
  return env.ASSETS.fetch(request);
};

/**
 * `observe` is what reads the `OTEL_EXPORTER_*` bindings back and flushes the
 * request's spans through `waitUntil`. This Worker is a plain
 * `ExportedHandler`, so alchemy's runtime bridge never runs for it and nothing
 * else would.
 */
export default { fetch: observe(handle) };

/** The denial describes OUR configuration, never the caller's token. */
const refused = (denial: string, detail: string, request: Request): Response => {
  const saw = [...request.headers.keys()].filter((name) => name.startsWith("cf-")).sort();
  console.log(`access denied: ${denial} — ${detail} — cf headers: ${saw.join(", ") || "(none)"}`);
  return new Response(`unauthorized: ${denial}\n${detail}\n`, {
    status: 401,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Mezedes-Denial": denial },
  });
};
