/**
 * Where a client is entitled to look for this server's discovery documents.
 *
 * `api/config.ts` silences Better Auth's own "please ensure this path exists"
 * warning on the strength of `app/worker.ts` forwarding these. This file is the
 * strength: delete the forwarding and the warning stays silenced, so the test
 * is what stands between a rewritten path and a client that reads an SPA shell
 * where a JSON document should be.
 */

import { describe, expect, test } from "vite-plus/test";

import { AUTH_BASE_PATH, oauthMetadataTarget } from "../shared/ingress.ts";

const AUTH_SERVER = "/.well-known/oauth-authorization-server";
const OPENID = "/.well-known/openid-configuration";

describe("the authorization server document", () => {
  const canonical = `${AUTH_BASE_PATH}${AUTH_SERVER}`;

  test("under the issuer path, which is where Better Auth serves it", () => {
    expect(oauthMetadataTarget(canonical)).toBe(canonical);
  });

  test("at the root, which is where a client with only an origin looks", () => {
    expect(oauthMetadataTarget(AUTH_SERVER)).toBe(canonical);
  });

  test("with the issuer path inserted after it — RFC 8414 §3.1's spelling", () => {
    expect(oauthMetadataTarget(`${AUTH_SERVER}${AUTH_BASE_PATH}`)).toBe(canonical);
  });
});

describe("the OpenID configuration", () => {
  const canonical = `${AUTH_BASE_PATH}${OPENID}`;

  test("under the issuer path — OpenID Discovery's own spelling", () => {
    expect(oauthMetadataTarget(canonical)).toBe(canonical);
  });

  test("at the root", () => {
    expect(oauthMetadataTarget(OPENID)).toBe(canonical);
  });

  test("with the issuer path inserted after it", () => {
    expect(oauthMetadataTarget(`${OPENID}${AUTH_BASE_PATH}`)).toBe(canonical);
  });
});

describe("everything else is the app's", () => {
  test.each([
    "/",
    "/sign-in",
    "/.well-known/",
    "/.well-known/oauth-protected-resource",
    `${AUTH_SERVER}/`,
    `${AUTH_SERVER}/api`,
    `${AUTH_BASE_PATH}/oauth2/token`,
  ])("%s", (pathname) => {
    expect(oauthMetadataTarget(pathname)).toBeNull();
  });

  test("`oauth-protected-resource` in particular, because it is mezes' to publish", () => {
    // The resource server describes itself. This server describing a resource
    // it does not host is how a client ends up trusting the wrong `aud`.
    expect(oauthMetadataTarget("/.well-known/oauth-protected-resource")).toBeNull();
    expect(
      oauthMetadataTarget(`${AUTH_BASE_PATH}/.well-known/oauth-protected-resource`),
    ).toBeNull();
  });
});
