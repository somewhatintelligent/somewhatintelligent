/**
 * THE CONSOLE'S GATE, under test.
 *
 * This is the only authorization in front of Commerce — the Worker performs
 * none of its own and trusts `meta.actor` as already validated by whoever bound
 * it. So the properties worth proving are the refusals, not the accept: a token
 * for a DIFFERENT Access application on the same team, a token signed by the
 * wrong key, and a service token with no `email` all have to fail, and each one
 * of them verifies fine against a check that forgot one clause.
 *
 * A LOCAL JWKS, so nothing here touches the network. `verifyAccessToken` takes
 * its key resolver as a parameter for exactly this reason.
 */
import { describe, expect, test } from "bun:test";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from "jose";

import { resolveOperator, verifyAccessToken } from "../../app/lib/access.server.ts";
import type { OperatorEnv } from "../../app/operator-env.ts";

const TEAM = "https://example.cloudflareaccess.com";
const AUD = "the-console-application-aud";

const keys = await generateKeyPair("RS256", { extractable: true });
const publicJwk = (await exportJWK(keys.publicKey)) as JWK;
const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, alg: "RS256", kid: "test" }] });

const otherKeys = await generateKeyPair("RS256", { extractable: true });

const mint = (claims: Record<string, unknown>, options?: { key?: CryptoKey; expired?: boolean }) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuedAt(options?.expired ? Math.floor(Date.now() / 1000) - 7200 : undefined)
    .setExpirationTime(options?.expired ? Math.floor(Date.now() / 1000) - 3600 : "1h")
    .sign(options?.key ?? keys.privateKey);

const config = { teamDomain: TEAM, policyAud: AUD };

describe("verifyAccessToken", () => {
  test("accepts a well-formed assertion and derives the actor from its claims", async () => {
    const token = await mint({
      iss: TEAM,
      aud: AUD,
      sub: "abc123",
      email: "operator@example.com",
    });

    const result = await verifyAccessToken(token, config, jwks);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ sub: "abc123", email: "operator@example.com" });
    }
  });

  test("refuses a token minted for another application on the same team", async () => {
    // Every Access app on a team shares signing keys, so the audience claim is
    // the ONLY thing distinguishing this from a valid console token.
    const token = await mint({
      iss: TEAM,
      aud: "some-other-application",
      sub: "abc123",
      email: "operator@example.com",
    });

    const result = await verifyAccessToken(token, config, jwks);

    expect(result.ok).toBe(false);
  });

  test("refuses a token from another issuer", async () => {
    const token = await mint({
      iss: "https://attacker.cloudflareaccess.com",
      aud: AUD,
      sub: "abc123",
      email: "operator@example.com",
    });

    expect((await verifyAccessToken(token, config, jwks)).ok).toBe(false);
  });

  test("refuses a token signed by a key the team does not publish", async () => {
    const token = await mint(
      { iss: TEAM, aud: AUD, sub: "abc123", email: "operator@example.com" },
      { key: otherKeys.privateKey },
    );

    expect((await verifyAccessToken(token, config, jwks)).ok).toBe(false);
  });

  test("refuses an expired token", async () => {
    const token = await mint(
      { iss: TEAM, aud: AUD, sub: "abc123", email: "operator@example.com" },
      { expired: true },
    );

    expect((await verifyAccessToken(token, config, jwks)).ok).toBe(false);
  });

  test("refuses a service token, which carries no email", async () => {
    // A machine identity has no user behind it, so it has no actor to file
    // audit rows under — filing its writes under an empty subject is the
    // failure this prevents.
    const token = await mint({ iss: TEAM, aud: AUD, sub: "abc123", common_name: "ci-runner" });

    const result = await verifyAccessToken(token, config, jwks);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unauthorized");
  });

  test("refuses a token with no subject", async () => {
    const token = await mint({ iss: TEAM, aud: AUD, email: "operator@example.com" });

    expect((await verifyAccessToken(token, config, jwks)).ok).toBe(false);
  });
});

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

  test("accepts a request carrying a valid assertion", async () => {
    const token = await mint({
      iss: TEAM,
      aud: AUD,
      sub: "abc123",
      email: "operator@example.com",
    });
    const request = new Request("https://desk.test/", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });

    const result = await resolveOperator(request, envFor({ OPERATOR_AUTH: "access" }), jwks);

    expect(result.ok).toBe(true);
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
