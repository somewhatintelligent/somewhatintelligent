/**
 * THE CONSOLE'S GATE, under test — the console's own rules only.
 *
 * The verifier's properties (audience pinning, issuer pinning, signature,
 * expiry, algorithm) moved to `packages/lib.access-jwt/test/verify.test.ts`
 * with the verifier. Proving them again here would test `jose` twice and prove
 * nothing about this app.
 *
 * What is left is what this app decides on top, and each clause is one that a
 * plausible refactor deletes without any other test noticing:
 *
 *   - `OPERATOR_AUTH` is the ONLY way to the dev actor, and an unrecognised
 *     value is misconfiguration rather than an open door.
 *   - A SERVICE TOKEN IS REFUSED HERE even though the shared verifier admits
 *     one, because the ledger is keyed by a person.
 *
 * A LOCAL JWKS, so nothing here touches the network — `resolveOperator` takes
 * its key resolver as a parameter for exactly this reason.
 */
import { describe, expect, test } from "bun:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";

import { resolveOperator } from "../../app/lib/access.server.ts";
import type { OperatorEnv } from "../../app/operator-env.ts";

const TEAM = "https://example.cloudflareaccess.com";
const AUD = "the-console-application-aud";

const keys = await generateKeyPair("RS256", { extractable: true });
const publicJwk = (await exportJWK(keys.publicKey)) as JWK;
const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, alg: "RS256", kid: "test" }] });

const mint = (claims: Record<string, unknown>) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setExpirationTime("1h")
    .sign(keys.privateKey);

const requestWith = (token: string) =>
  new Request("https://desk.test/", { headers: { "Cf-Access-Jwt-Assertion": token } });

describe("resolveOperator", () => {
  const envFor = (overrides: Partial<OperatorEnv>) =>
    ({ POLICY_AUD: AUD, TEAM_DOMAIN: TEAM, ...overrides }) as unknown as OperatorEnv;

  test("fails CLOSED when the gate is unconfigured", async () => {
    for (const env of [
      envFor({ OPERATOR_AUTH: "access", POLICY_AUD: undefined }),
      envFor({ OPERATOR_AUTH: "access", TEAM_DOMAIN: undefined }),
    ]) {
      const result = await resolveOperator(new Request("https://desk.test/"), env, jwks);
      expect(result.ok).toBe(false);
      // MISCONFIGURED, not unauthorized: the caller answers 500, because a 403
      // would send an operator to fix their Access membership when the deploy
      // is what is broken.
      if (!result.ok) expect(result.error).toBe("misconfigured");
    }
  });

  test("treats an unrecognised OPERATOR_AUTH as misconfiguration, never as open", async () => {
    const result = await resolveOperator(
      new Request("https://desk.test/"),
      envFor({ OPERATOR_AUTH: undefined as never }),
      jwks,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("misconfigured");
  });

  test("refuses a request Access did not front", async () => {
    const result = await resolveOperator(
      new Request("https://desk.test/"),
      envFor({ OPERATOR_AUTH: "access" }),
      jwks,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unauthorized");
  });

  test("accepts a request carrying a valid assertion and derives the actor from its claims", async () => {
    const token = await mint({
      iss: TEAM,
      aud: AUD,
      sub: "abc123",
      email: "operator@example.com",
    });

    const result = await resolveOperator(
      requestWith(token),
      envFor({ OPERATOR_AUTH: "access" }),
      jwks,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ sub: "abc123", email: "operator@example.com" });
  });

  test("refuses a service token, which carries no email", async () => {
    // `lib.access-jwt` admits this one — a machine identity is a legitimate way
    // to reach a preview. The CONSOLE refuses it, because there is no person to
    // file its writes under, and that is the clause this test exists to hold.
    const token = await mint({ iss: TEAM, aud: AUD, sub: "abc123", common_name: "ci-runner" });

    const result = await resolveOperator(
      requestWith(token),
      envFor({ OPERATOR_AUTH: "access" }),
      jwks,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unauthorized");
  });

  test("the dev actor is reachable only through OPERATOR_AUTH=none", async () => {
    const local = await resolveOperator(
      new Request("https://localhost/"),
      envFor({ OPERATOR_AUTH: "none" }),
      jwks,
    );
    expect(local.ok).toBe(true);
    if (local.ok) expect(local.value.sub).toBe("operator:dev");

    // The same request against a deployed configuration gets nothing.
    const deployed = await resolveOperator(
      new Request("https://localhost/"),
      envFor({ OPERATOR_AUTH: "access" }),
      jwks,
    );
    expect(deployed.ok).toBe(false);
  });
});
