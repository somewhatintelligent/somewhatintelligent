/**
 * THE EDGE GATE, on this side of the edge.
 *
 * Cloudflare Access already refused everyone the staff policy does not name
 * before a request reached this Worker — that is what the `Access.Application`
 * in `module.ts` does. This file re-verifies the assertion anyway, and the
 * duplication is the point: a Worker is reachable by its script name from
 * inside the account, an Access application is per hostname, and a
 * misconfiguration that removes the gate is invisible from the outside. Trusting
 * the header without checking the signature turns any of those into
 * unauthenticated write access to the catalogue and the order book, because
 * Commerce does no authorization of its own.
 *
 * IT FAILS CLOSED. No configuration is a 500, not a bypass; no token is a 403;
 * a token that does not verify is a 403. The only path that returns an actor
 * without a token is `OPERATOR_AUTH === "none"`, which `module.ts` sets under
 * `alchemy dev` alone and never on a deploy.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import type { DomainResult, OperatorActor } from "../../domain/Contracts.ts";
import { err, ok } from "../../domain/Contracts.ts";
import type { OperatorEnv } from "../operator-env.ts";

export type AccessError = "unauthorized" | "misconfigured";

/** Access puts the application's signed assertion here on every request it fronts. */
const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

/**
 * The algorithms Access actually signs with, named so a token claiming anything
 * else is refused before a key is fetched. An unbounded `alg` is what algorithm
 * confusion needs.
 */
const ALGORITHMS = ["RS256", "ES256"];

/**
 * The actor a local dev session runs as. FIXED, and it never reaches a deploy:
 * `module.ts` sets `OPERATOR_AUTH` to `"none"` only under `alchemy dev`, and the
 * `sub` is spelled so it is obvious in an audit row that this was not a person.
 *
 * It is a real subject rather than an empty one because every mutation is
 * keyed by it — `deriveIdempotencyKey` namespaces a command by actor — and the
 * dev ledger should look like the deployed one.
 */
const DEV_ACTOR: OperatorActor = {
  sub: "operator:dev",
  email: "dev@localhost",
};

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

interface AccessConfig {
  /** The issuer, exactly — Access mints `iss` as the team domain's origin. */
  readonly teamDomain: string;
  /** The application's own `aud`, sourced from the resource that minted it. */
  readonly policyAud: string;
}

/**
 * BOTH VALUES OR NEITHER. An `aud` with no issuer cannot be verified against
 * anything, and an issuer with no `aud` would accept a token minted for a
 * DIFFERENT application on this account — every Access app on the team shares
 * the same signing keys, so the audience claim is the only thing that says
 * "this token was for the console".
 */
const readConfig = (env: OperatorEnv): AccessConfig | null => {
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
 * Verify an assertion and derive the actor from its claims. Signature, issuer,
 * audience, algorithm and expiry are all enforced; every failure mode collapses
 * to `unauthorized` so a caller learns nothing from the difference between a
 * forged token and an expired one.
 *
 * `sub` and `email` are both REQUIRED. `sub` is what every audit row and every
 * idempotency key is namespaced by, and `email` is what a human reading that
 * ledger needs. An Access SERVICE token carries neither — it is a machine
 * identity — so this refuses one rather than filing its writes under an empty
 * subject.
 *
 * `getKey` is a parameter so a test can inject a local JWKS and never touch the
 * network.
 */
export const verifyAccessToken = async (
  token: string,
  config: AccessConfig,
  getKey: JWTVerifyGetKey,
): Promise<DomainResult<OperatorActor, "unauthorized">> => {
  try {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: config.teamDomain,
      audience: config.policyAud,
      algorithms: ALGORITHMS,
    });
    const { sub, email } = payload;
    if (typeof sub !== "string" || sub.length === 0) {
      return err("unauthorized", "Access token carries no sub claim");
    }
    if (typeof email !== "string" || email.length === 0) {
      return err(
        "unauthorized",
        "Access token carries no email claim — service tokens have none, so authenticate as a user",
      );
    }
    return ok({ sub, email });
  } catch {
    return err("unauthorized", "Access token failed verification");
  }
};

/**
 * Resolve the operator for one request.
 *
 * `OPERATOR_AUTH` decides which of two worlds this is, and it is set by the
 * deploy rather than inferred from a hostname or a stage name — the console has
 * no way to tell a local port from a real one, and guessing wrong in the
 * permissive direction is the whole failure.
 *
 *   `"none"`    local `alchemy dev` only. The gate is ABSENT from the request
 *               path rather than present and declining to act.
 *   `"access"`  everything else. A verified assertion or nothing.
 *
 * Anything else — including the value being missing, which is what an
 * incomplete deploy looks like — is `misconfigured`, and the caller answers
 * 500. That is deliberately not a 403: a 403 reads as "you are not staff" and
 * would send someone to fix their Access membership when the deploy is what is
 * broken.
 */
export const resolveOperator = async (
  request: Request,
  env: OperatorEnv,
  getKey?: JWTVerifyGetKey,
): Promise<DomainResult<OperatorActor, AccessError>> => {
  if (env.OPERATOR_AUTH === "none") return ok(DEV_ACTOR);

  if (env.OPERATOR_AUTH !== "access") {
    return err(
      "misconfigured",
      `OPERATOR_AUTH is ${JSON.stringify(env.OPERATOR_AUTH)}; expected "access" or "none"`,
    );
  }

  const config = readConfig(env);
  if (!config) {
    return err(
      "misconfigured",
      "POLICY_AUD and TEAM_DOMAIN must both be set. POLICY_AUD is the Access application's own aud",
    );
  }

  const token = request.headers.get(ACCESS_HEADER);
  if (!token) {
    return err("unauthorized", `no ${ACCESS_HEADER} header — Access did not front this request`);
  }

  return verifyAccessToken(token, config, getKey ?? jwksFor(config.teamDomain));
};
