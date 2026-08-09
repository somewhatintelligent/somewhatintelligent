/**
 * WHICH REQUESTS BELONG TO THE AUTH WORKER, and what they should say when they
 * get there. Both pinned as pure decisions.
 *
 * `app/worker.ts` is the only thing standing between a request and the auth
 * binding, and it makes two calls per request. `servedByAuth` decides whose
 * request it is. `oauthMetadataTarget` decides what a discovery request should
 * be REWRITTEN to, because the paths a client is entitled to try mostly do not
 * live under the base path at all — RFC 8414 puts the metadata for an issuer
 * with a path at the origin root, and a client holding only an origin looks
 * there first.
 *
 * `api/config.ts` silences Better Auth's "please ensure this path exists"
 * warning on the strength of that routing. This file and
 * `test/discovery.test.ts` are the strength: delete the routing and the warning
 * stays silenced, so a test is what stands between a rewritten path and a
 * client that reads an SPA shell where a JSON document should be.
 *
 * Pinned as decisions rather than through a booted Worker because a routing
 * failure is a decision, not a handler — asserting it directly is what makes a
 * red test say which line is wrong. `integ/oauth-provider.integ.test.ts` is the
 * other half: it drives the deployed ingress, where a handler that answers
 * cannot save a route that never arrives.
 */

import * as Effect from "effect/Effect";
import { describe, expect, test } from "vite-plus/test";

import { authOptions } from "../api/options.ts";
import {
  AUTH_BASE_PATH,
  OAUTH_METADATA_PATH,
  oauthMetadataTarget,
  servedByAuth,
} from "../shared/ingress.ts";

const AUTH_SERVER = "/.well-known/oauth-authorization-server";
const OPENID = "/.well-known/openid-configuration";

describe("the base path", () => {
  for (const pathname of [
    AUTH_BASE_PATH,
    `${AUTH_BASE_PATH}/sign-in/email`,
    `${AUTH_BASE_PATH}/oauth2/register`,
    `${AUTH_BASE_PATH}/.well-known/openid-configuration`,
    `${AUTH_BASE_PATH}/.well-known/oauth-authorization-server`,
  ]) {
    test(`${pathname} → auth worker`, () => {
      expect(servedByAuth(pathname)).toBe(true);
    });
  }

  test("does not swallow a sibling that merely starts with the same characters", () => {
    expect(servedByAuth("/api/authenticate")).toBe(false);
    expect(servedByAuth(`${AUTH_BASE_PATH}-v2/sign-in`)).toBe(false);
  });

  test("does not claim the discovery paths outside it — those get rewritten", () => {
    // `servedByAuth` forwards unchanged, which is the wrong answer for a path
    // Better Auth does not recognise. `oauthMetadataTarget` owns these.
    expect(servedByAuth(OAUTH_METADATA_PATH)).toBe(false);
    expect(servedByAuth(AUTH_SERVER)).toBe(false);
  });
});

describe("the RFC 8414 root alias", () => {
  /**
   * A LITERAL, not the expression from the definition.
   *
   * The first version of this interpolated `AUTH_BASE_PATH` — the same constant
   * `OAUTH_METADATA_PATH` is built from — so it restated the definition and
   * could not have failed for any change to it, while being named as though it
   * could. This string is the URL out of Better Auth's own boot warning, so it
   * pins the result rather than the arithmetic.
   */
  test("is the URL Better Auth names in its startup warning", () => {
    expect(OAUTH_METADATA_PATH).toBe("/.well-known/oauth-authorization-server/api/auth");
  });

  /**
   * THE COUPLING THAT IS EASY TO BREAK FROM A DISTANCE.
   *
   * The plugin does not derive its well-known paths from the base path — it
   * derives them from the ISSUER, which is `jwt.issuer ?? baseURL`. Those agree
   * today only because `jwt()` is configured without one. Giving the JWT plugin
   * a stable issuer — an ordinary thing to want, so that tokens verify the same
   * across stages — moves the plugin's aliases and leaves this constant, and
   * every rewrite below, pointing at paths nothing answers.
   *
   * Asserted against the resolved configuration rather than the source, so it
   * holds however the issuer comes to be set.
   */
  test("tracks the issuer the plugin derives its own paths from", async () => {
    const options = await Effect.runPromise(authOptions);
    const jwtPlugin = (options.plugins ?? []).find((plugin) => plugin.id === "jwt") as
      | { options?: { jwt?: { issuer?: string } } }
      | undefined;

    const issuer = jwtPlugin?.options?.jwt?.issuer;
    const issuerPath =
      issuer === undefined ? AUTH_BASE_PATH : new URL(issuer).pathname.replace(/\/$/, "");

    expect(OAUTH_METADATA_PATH).toBe(`/.well-known/oauth-authorization-server${issuerPath}`);
    expect(oauthMetadataTarget(OAUTH_METADATA_PATH)).toBe(`${issuerPath}${AUTH_SERVER}`);
  });
});

/**
 * Both documents, both spelt three ways. The rules differ by specification —
 * OpenID Discovery appends the segment to the issuer, RFC 8414 §3.1 inserts the
 * issuer path after it, and a client holding only an origin tries neither — but
 * the mapping is one rule, so it is asserted as one.
 */
describe.each([AUTH_SERVER, OPENID])("%s", (document) => {
  const canonical = `${AUTH_BASE_PATH}${document}`;

  test("under the issuer path, which is where Better Auth serves it", () => {
    expect(oauthMetadataTarget(canonical)).toBe(canonical);
  });

  test("at the root, which is where a client with only an origin looks", () => {
    expect(oauthMetadataTarget(document)).toBe(canonical);
  });

  test("with the issuer path inserted after it", () => {
    expect(oauthMetadataTarget(`${document}${AUTH_BASE_PATH}`)).toBe(canonical);
  });
});

describe("everything else stays with the app", () => {
  for (const pathname of [
    "/",
    "/sign-in",
    "/consent",
    "/avatars/abc",
    "/.well-known/",
    // Not a blanket `/.well-known/` forward: this origin serves a site too.
    "/.well-known/apple-app-site-association",
    "/.well-known/security.txt",
    "/.well-known/assetlinks.json",
    `${AUTH_SERVER}/`,
    `${AUTH_SERVER}/api`,
  ]) {
    test(`${pathname} → app`, () => {
      expect(servedByAuth(pathname)).toBe(false);
      expect(oauthMetadataTarget(pathname)).toBeNull();
    });
  }

  test("`oauth-protected-resource` in particular, because it is mezes' to publish", () => {
    // The resource server describes itself. This server describing a resource
    // it does not host is how a client ends up trusting the wrong `aud`.
    expect(oauthMetadataTarget("/.well-known/oauth-protected-resource")).toBeNull();
    expect(
      oauthMetadataTarget(`${AUTH_BASE_PATH}/.well-known/oauth-protected-resource`),
    ).toBeNull();
  });
});
