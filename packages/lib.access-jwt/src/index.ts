/**
 * THE EDGE GATE, on this side of the edge.
 *
 * Cloudflare Access refuses everyone the stage's policy does not name before a
 * request reaches a Worker at all — that is what the `Access.Application` is
 * for. Every Worker in this repo re-verifies the assertion anyway, and the
 * duplication is the point: a Worker is reachable by its script name from
 * inside the account, an Access application is per hostname, and a
 * misconfiguration that removes the gate is invisible from the outside.
 * Trusting the header without checking the signature turns any of those into
 * unauthenticated access.
 *
 * IT FAILS CLOSED. No configuration is `misconfigured` — a 500 at the caller,
 * not a bypass; no token is `unauthorized`; a token that does not verify is
 * `unauthorized`. There is no path here that returns a principal without one.
 *
 * A LEAF MODULE, and it has to stay that way: no `alchemy` import, no `effect`
 * import, one runtime dependency (`jose`). Its importers are the auth worker,
 * the site's middleware and media route, the media surface, and the operator
 * console's `access.server.ts` — and a deploy-time symbol reaching any of
 * their bundles is the failure `infra/stage/sandbox.ts` documents for the same
 * reason. Mezedes and the inbox still run their own older verifiers; migrating
 * them here is deliberate follow-up work, not an accident of omission.
 *
 * Lifted from `apps/platform.commerce/app/lib/access.server.ts`, which was the
 * strictest of the three verifiers the repo had grown.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** Access puts the application's signed assertion here on every request it fronts. */
export const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

/**
 * The algorithms Access actually signs with, named so a token claiming anything
 * else is refused before a key is fetched. An unbounded `alg` is what algorithm
 * confusion needs.
 */
const ALGORITHMS = ["RS256", "ES256"];

/**
 * The two env vars every gated Worker carries. Both are set by the deploy from
 * the Access application that mints the tokens, so neither can be inferred at
 * runtime and a Worker that is missing one cannot verify anything.
 */
export interface AccessEnv {
  /** The application's own `aud`, sourced from the resource that minted it. */
  readonly POLICY_AUD?: string | undefined;
  /** The team domain, with or without a scheme. Access mints `iss` as its origin. */
  readonly TEAM_DOMAIN?: string | undefined;
}

/**
 * Who the verified assertion says is calling.
 *
 * `email` is OPTIONAL here and required by some callers. An Access SERVICE
 * token is a machine identity: it carries `common_name` and no email, which is
 * exactly right for a CI runner curling a preview and exactly wrong for the
 * operator console, whose every audit row is keyed by a person. So this layer
 * reports what the token said and the call site decides whether a machine is
 * allowed to do that — see `access.server.ts`, which re-tightens it.
 */
export interface Principal {
  readonly sub: string;
  readonly email: string | undefined;
}

export type AccessError = "unauthorized" | "misconfigured";

export type Verdict =
  | { readonly ok: true; readonly principal: Principal }
  | { readonly ok: false; readonly error: AccessError; readonly detail: string };

/**
 * One JWKS resolver per team domain per isolate. `createRemoteJWKSet` keeps its
 * own key cache, its own rotation cooldown, and coalesces concurrent fetches —
 * reusing the instance is what stops every request re-fetching
 * `${teamDomain}/cdn-cgi/access/certs`, and what stops a bogus `kid` becoming a
 * request storm against Cloudflare.
 */
const jwksByTeamDomain = new Map<string, JWTVerifyGetKey>();

const jwksFor = (teamDomain: string): JWTVerifyGetKey => {
  const existing = jwksByTeamDomain.get(teamDomain);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  jwksByTeamDomain.set(teamDomain, created);
  return created;
};

export interface AccessConfig {
  /** The issuer, exactly — Access mints `iss` as the team domain's origin. */
  readonly teamDomain: string;
  readonly policyAud: string;
}

/**
 * BOTH VALUES OR NEITHER. An `aud` with no issuer cannot be verified against
 * anything, and an issuer with no `aud` would accept a token minted for a
 * DIFFERENT application on this account — every Access app on the team shares
 * the same signing keys, so the audience claim is the only thing that says
 * "this token was for me".
 */
export const readConfig = (env: AccessEnv): AccessConfig | null => {
  const policyAud = env.POLICY_AUD?.trim();
  const team = env.TEAM_DOMAIN?.trim();
  if (!policyAud || !team) return null;
  try {
    const url = new URL(team.includes("://") ? team : `https://${team}`);
    return url.protocol === "https:" ? { teamDomain: url.origin, policyAud } : null;
  } catch {
    return null;
  }
};

/**
 * Verify an assertion and read the principal off its claims. Signature, issuer,
 * audience, algorithm and expiry are all enforced; every failure mode collapses
 * to `unauthorized` so a caller learns nothing from the difference between a
 * forged token and an expired one.
 *
 * `getKey` is a parameter so a test can inject a local JWKS and never touch the
 * network.
 */
export const verifyToken = async (
  token: string,
  config: AccessConfig,
  getKey: JWTVerifyGetKey,
): Promise<Verdict> => {
  try {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: config.teamDomain,
      audience: config.policyAud,
      algorithms: ALGORITHMS,
    });
    const { sub, email } = payload;
    if (typeof sub !== "string" || sub.length === 0) {
      return { ok: false, error: "unauthorized", detail: "Access token carries no sub claim" };
    }
    return {
      ok: true,
      principal: { sub, email: typeof email === "string" && email.length > 0 ? email : undefined },
    };
  } catch {
    return { ok: false, error: "unauthorized", detail: "Access token failed verification" };
  }
};

/**
 * Verify one assertion value — the whole gate, minus the header read. For
 * callers whose request object is not a web `Request` (the Effect HTTP
 * wrapper's headers are a plain record), so nobody has to build a throwaway
 * `Request` just to hand this a string.
 *
 * `misconfigured` is deliberately distinct from `unauthorized`: a 403 reads as
 * "you are not staff" and would send someone to fix their Access membership
 * when the deploy is what is broken.
 */
export const verifyAssertion = async (
  token: string | undefined,
  env: AccessEnv,
  getKey?: JWTVerifyGetKey,
): Promise<Verdict> => {
  const config = readConfig(env);
  if (!config) {
    return {
      ok: false,
      error: "misconfigured",
      detail:
        "POLICY_AUD and TEAM_DOMAIN must both be set. POLICY_AUD is the Access application's own aud",
    };
  }

  if (!token) {
    return {
      ok: false,
      error: "unauthorized",
      detail: `no ${ACCESS_HEADER} header — Access did not front this request`,
    };
  }

  return verifyToken(token, config, getKey ?? jwksFor(config.teamDomain));
};

/** Verify the assertion on one request. */
export const verifyAccess = (
  request: Request,
  env: AccessEnv,
  getKey?: JWTVerifyGetKey,
): Promise<Verdict> =>
  verifyAssertion(request.headers.get(ACCESS_HEADER) ?? undefined, env, getKey);

/**
 * The response a refused request gets, so five Workers cannot disagree about
 * what a failed gate looks like.
 *
 * A 403 RATHER THAN A REDIRECT, and that is not a downgrade. If the Access edge
 * is enforcing, no unauthenticated request reaches the Worker at all and the
 * redirect UX is Access's own; if it is NOT enforcing, this is the only refusal
 * there is, and a redirect it issued itself would be a login page served by the
 * very thing that failed to check the login.
 */
export const refusal = (verdict: Extract<Verdict, { ok: false }>): Response =>
  verdict.error === "misconfigured"
    ? new Response("access is misconfigured for this deployment", { status: 500 })
    : new Response("forbidden", { status: 403 });
