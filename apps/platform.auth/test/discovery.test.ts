/**
 * The document a client actually reads, from the server that actually serves
 * it.
 *
 * Everything else about this flow is asserted against the configuration, which
 * is one translation away from what an MCP client sees. This file closes that
 * gap: it builds the real Better Auth instance over an in-memory store and asks
 * it the same question a coding agent asks first. A discovery document that
 * omits `registration_endpoint` is a server the agent reports as needing a
 * client id nobody has, and no assertion about `allowDynamicClientRegistration`
 * would have caught it.
 *
 * See `test/auth-instance.ts` for what is and is not swapped out to get one.
 */

import { beforeAll, describe, expect, test } from "vite-plus/test";

import { AUTH_BASE_PATH, oauthMetadataTarget } from "../shared/ingress.ts";
import { mezesAudience } from "../shared/resources.ts";
import { MEZES_SCOPES } from "../shared/scopes.ts";
import { authInstance, MEZES, MEZES_ORIGIN, ORIGIN } from "./auth-instance.ts";

const ISSUER = `${ORIGIN}${AUTH_BASE_PATH}`;

const { ask } = authInstance();

/** The two documents, keyed by the path this app rewrites everything else onto. */
const documents = new Map<string, Record<string, unknown>>();

beforeAll(async () => {
  for (const document of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ]) {
    const pathname = `${AUTH_BASE_PATH}${document}`;
    const response = await ask(pathname);
    expect(response.status, `${pathname} answered ${response.status}`).toBe(200);
    documents.set(pathname, (await response.json()) as Record<string, unknown>);
  }
});

const metadata = (document: string): Record<string, unknown> => {
  const found = documents.get(`${AUTH_BASE_PATH}${document}`);
  if (!found) throw new Error(`${document} was not fetched`);
  return found;
};

describe.each([["/.well-known/oauth-authorization-server"], ["/.well-known/openid-configuration"]])(
  "%s",
  (document) => {
    test("names the issuer the tokens will carry", () => {
      expect(metadata(document).issuer).toBe(ISSUER);
    });

    test("points a client at somewhere to register itself", () => {
      // Absent unless `allowDynamicClientRegistration` is on — which is the whole
      // difference between a server an agent can connect to and one it cannot.
      expect(metadata(document).registration_endpoint).toBe(`${ISSUER}/oauth2/register`);
    });

    test("advertises the endpoints the flow runs through", () => {
      expect(metadata(document)).toMatchObject({
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        jwks_uri: `${ISSUER}/jwks`,
        revocation_endpoint: `${ISSUER}/oauth2/revoke`,
      });
    });

    test("requires PKCE's only sound method, and offers no other", () => {
      expect(metadata(document).code_challenge_methods_supported).toEqual(["S256"]);
    });

    test("accepts a client that holds no secret", () => {
      expect(metadata(document).token_endpoint_auth_methods_supported).toContain("none");
    });

    test("offers no grant that skips the person", () => {
      expect(metadata(document).grant_types_supported).toEqual([
        "authorization_code",
        "refresh_token",
      ]);
    });

    test("lists the mezes scopes, so a client knows to ask for them", () => {
      const scopes = metadata(document).scopes_supported;
      for (const scope of Object.keys(MEZES_SCOPES)) expect(scopes).toContain(scope);
      expect(scopes).toContain("offline_access");
    });
  },
);

describe("the OpenID half", () => {
  test("carries what only it does", () => {
    expect(metadata("/.well-known/openid-configuration")).toMatchObject({
      userinfo_endpoint: `${ISSUER}/oauth2/userinfo`,
      subject_types_supported: ["public"],
    });
  });
});

describe("the paths app/worker.ts rewrites onto", () => {
  test("are ones this server answers — the rewrite targets are not guesses", async () => {
    for (const spelling of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/api/auth",
      "/.well-known/openid-configuration",
      "/.well-known/openid-configuration/api/auth",
    ]) {
      const target = oauthMetadataTarget(spelling);
      expect(target, `${spelling} resolves to nothing`).not.toBeNull();
      const response = await ask(target!);
      expect(response.status, `${target} answered ${response.status}`).toBe(200);
    }
  });
});

describe("the mezes audience this stage was given", () => {
  test("is the one shared/resources.ts derives, byte for byte", () => {
    // The harness writes the audience out; this is what stops it drifting from
    // the function the deploy actually calls.
    expect(mezesAudience(MEZES_ORIGIN)).toBe(MEZES);
  });
});
