/**
 * THE CONSOLE'S GATE — the console's rules only.
 *
 * The verifier itself moved to `lib.access-jwt`, because five Workers across
 * four apps needed it and three of them had grown their own. What is left here
 * is what is genuinely the OPERATOR CONSOLE's and would be wrong to impose on
 * the others:
 *
 *   - `OPERATOR_AUTH` decides which of two worlds a request is in, and it is
 *     set by the deploy rather than inferred — the console cannot tell a local
 *     port from a real one, and guessing wrong in the permissive direction is
 *     the whole failure.
 *   - A SERVICE TOKEN IS REFUSED. `lib.access-jwt` admits one and reports no
 *     email, which is right for a CI runner curling a preview. It is wrong
 *     here: every mutation is filed under the actor and `deriveIdempotencyKey`
 *     namespaces a command by it, so a machine identity would file writes to
 *     the catalogue and the order book under nobody.
 *   - The DEV actor, whose `sub` is spelled so an audit row makes it obvious
 *     this was not a person.
 *
 * Commerce does no authorization of its own — it trusts `meta.actor` as already
 * validated by whoever bound it, and this file is that whoever. It fails
 * closed: no configuration is a 500, not a bypass; no token is a 403; a token
 * that does not verify is a 403.
 */
import type { JWTVerifyGetKey } from "jose";
import { verifyAccess } from "lib.access-jwt";

import type { DomainResult, OperatorActor } from "../../domain/Contracts.ts";
import { err, ok } from "../../domain/Contracts.ts";
import type { OperatorEnv } from "../operator-env.ts";

export type AccessError = "unauthorized" | "misconfigured";

/**
 * The actor a local dev session runs as. FIXED, and it never reaches a deploy:
 * `module.ts` sets `OPERATOR_AUTH` to `"none"` only under `alchemy dev`.
 *
 * It is a real subject rather than an empty one because every mutation is keyed
 * by it, and the dev ledger should look like the deployed one.
 */
const DEV_ACTOR: OperatorActor = {
  sub: "operator:dev",
  email: "dev@localhost",
};

/**
 * Resolve the operator for one request.
 *
 *   `"none"`    local `alchemy dev` only. The gate is ABSENT from the request
 *               path rather than present and declining to act.
 *   `"access"`  everything else. A verified assertion from a PERSON, or
 *               nothing.
 *
 * Anything else — including the value being missing, which is what an
 * incomplete deploy looks like — is `misconfigured`, and the caller answers
 * 500. That is deliberately not a 403: a 403 reads as "you are not staff" and
 * would send someone to fix their Access membership when the deploy is what is
 * broken.
 *
 * `getKey` is a parameter so a test can inject a local JWKS and never touch the
 * network.
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

  const verdict = await verifyAccess(request, env, getKey);
  if (!verdict.ok) return err(verdict.error, verdict.detail);

  const { sub, email } = verdict.principal;
  if (email === undefined) {
    return err(
      "unauthorized",
      "Access token carries no email claim — service tokens have none, so authenticate as a user",
    );
  }

  return ok({ sub, email });
};
