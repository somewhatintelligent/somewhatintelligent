/**
 * THE GATE, under test.
 *
 * The properties worth proving are the refusals, not the accept: a token for a
 * DIFFERENT Access application on the same team, a token signed by the wrong
 * key, an expired one, and a request Access never fronted all have to fail, and
 * every one of them verifies fine against a check that forgot one clause.
 *
 * A LOCAL JWKS, so nothing here touches the network — `verifyAccess` takes its
 * key resolver as a parameter for exactly this reason.
 *
 * Moved here from `apps/platform.commerce/tests/unit/operator-access.test.ts`
 * with the verifier. What stayed behind is the operator-specific half: that a
 * service token is refused BY THE CONSOLE, and that `OPERATOR_AUTH` decides
 * which world a request is in. Those are the console's rules, not the gate's.
 */
import { describe, expect, test } from "bun:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";

import { readConfig, verifyAccess, verifyToken } from "../src/index.ts";

const TEAM = "https://example.cloudflareaccess.com";
const AUD = "the-application-aud";

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

const requestWith = (token: string) =>
  new Request("https://gated.test/", { headers: { "Cf-Access-Jwt-Assertion": token } });

describe("verifyToken", () => {
  test("accepts a well-formed assertion and reads the principal off its claims", async () => {
    const token = await mint({ iss: TEAM, aud: AUD, sub: "abc123", email: "person@example.com" });

    const verdict = await verifyToken(token, config, jwks);

    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.principal).toEqual({ sub: "abc123", email: "person@example.com" });
    }
  });

  test("refuses a token minted for another application on the same team", async () => {
    // Every Access app on a team shares signing keys, so the audience claim is
    // the ONLY thing distinguishing this from a valid token.
    const token = await mint({
      iss: TEAM,
      aud: "some-other-application",
      sub: "abc123",
      email: "person@example.com",
    });

    expect((await verifyToken(token, config, jwks)).ok).toBe(false);
  });

  test("refuses a token from another issuer", async () => {
    const token = await mint({
      iss: "https://attacker.cloudflareaccess.com",
      aud: AUD,
      sub: "abc123",
      email: "person@example.com",
    });

    expect((await verifyToken(token, config, jwks)).ok).toBe(false);
  });

  test("refuses a token signed by a key the team does not publish", async () => {
    const token = await mint(
      { iss: TEAM, aud: AUD, sub: "abc123", email: "person@example.com" },
      { key: otherKeys.privateKey },
    );

    expect((await verifyToken(token, config, jwks)).ok).toBe(false);
  });

  test("refuses an expired token", async () => {
    const token = await mint(
      { iss: TEAM, aud: AUD, sub: "abc123", email: "person@example.com" },
      { expired: true },
    );

    expect((await verifyToken(token, config, jwks)).ok).toBe(false);
  });

  test("refuses a token with no subject", async () => {
    const token = await mint({ iss: TEAM, aud: AUD, email: "person@example.com" });

    expect((await verifyToken(token, config, jwks)).ok).toBe(false);
  });

  test("admits a service token, reporting no email", async () => {
    // A machine identity carries `common_name` and no email. THIS layer says so
    // and lets it through; a caller that keys audit rows by a person refuses it
    // on top — see the console's `resolveOperator`.
    const token = await mint({ iss: TEAM, aud: AUD, sub: "abc123", common_name: "ci-runner" });

    const verdict = await verifyToken(token, config, jwks);

    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.principal).toEqual({ sub: "abc123", email: undefined });
  });
});

describe("readConfig", () => {
  test("needs BOTH values, because either alone verifies nothing", () => {
    expect(readConfig({ POLICY_AUD: AUD, TEAM_DOMAIN: undefined })).toBeNull();
    expect(readConfig({ POLICY_AUD: undefined, TEAM_DOMAIN: TEAM })).toBeNull();
    expect(readConfig({ POLICY_AUD: "  ", TEAM_DOMAIN: TEAM })).toBeNull();
  });

  test("takes a bare team domain and normalises it to the issuer origin", () => {
    expect(readConfig({ POLICY_AUD: AUD, TEAM_DOMAIN: "example.cloudflareaccess.com" })).toEqual({
      teamDomain: TEAM,
      policyAud: AUD,
    });
  });

  test("refuses a plaintext team domain", () => {
    expect(
      readConfig({ POLICY_AUD: AUD, TEAM_DOMAIN: "http://example.cloudflareaccess.com" }),
    ).toBeNull();
  });
});

describe("verifyAccess", () => {
  const env = { POLICY_AUD: AUD, TEAM_DOMAIN: TEAM };

  test("fails CLOSED when the gate is unconfigured", async () => {
    for (const broken of [
      { POLICY_AUD: undefined, TEAM_DOMAIN: TEAM },
      { POLICY_AUD: AUD, TEAM_DOMAIN: undefined },
    ]) {
      const verdict = await verifyAccess(new Request("https://gated.test/"), broken, jwks);
      expect(verdict.ok).toBe(false);
      // MISCONFIGURED, not unauthorized: the caller answers 500, because a 403
      // would send someone to fix their Access membership when the deploy is
      // what is broken.
      if (!verdict.ok) expect(verdict.error).toBe("misconfigured");
    }
  });

  test("refuses a request Access did not front", async () => {
    const verdict = await verifyAccess(new Request("https://gated.test/"), env, jwks);

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toBe("unauthorized");
  });

  test("accepts a request carrying a valid assertion", async () => {
    const token = await mint({ iss: TEAM, aud: AUD, sub: "abc123", email: "person@example.com" });

    expect((await verifyAccess(requestWith(token), env, jwks)).ok).toBe(true);
  });
});
