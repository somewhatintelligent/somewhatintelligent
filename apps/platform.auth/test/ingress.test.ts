/**
 * WHICH REQUESTS BELONG TO THE AUTH WORKER, pinned as a predicate.
 *
 * `app/worker.ts` is the only thing standing between a request and the auth
 * binding, and one of the paths it has to forward does not live under the base
 * path at all: RFC 8414 puts the metadata for an issuer WITH a path at the
 * ORIGIN ROOT with the issuer's path appended. The plugin answers that URL;
 * routing it there is this repo's job, and nothing was doing it.
 *
 * Pinned here rather than through a booted Worker because the failure is a
 * routing decision, not a handler — asserting the decision directly is what
 * makes the test say which line is wrong.
 */

import * as Effect from "effect/Effect";
import { describe, expect, test } from "vite-plus/test";

import { authOptions } from "../api/options.ts";
import { AUTH_BASE_PATH, OAUTH_METADATA_PATH, servedByAuth } from "../shared/ingress.ts";

describe("the RFC 8414 root alias", () => {
  /**
   * A LITERAL, not the expression from the definition.
   *
   * The first version of this interpolated `AUTH_BASE_PATH` — the same
   * constant `OAUTH_METADATA_PATH` is built from — so it restated the
   * definition and could not have failed for any change to it, while being
   * named as though it could. This string is the URL out of Better Auth's own
   * boot warning, so it pins the result rather than the arithmetic.
   */
  test("is the URL Better Auth names in its startup warning", () => {
    expect(OAUTH_METADATA_PATH).toBe("/.well-known/oauth-authorization-server/api/auth");
  });

  test("routes to the auth worker, which is the whole point of this file", () => {
    expect(servedByAuth(OAUTH_METADATA_PATH)).toBe(true);
  });

  /**
   * THE COUPLING THAT IS EASY TO BREAK FROM A DISTANCE.
   *
   * The plugin does not derive its well-known paths from the base path — it
   * derives them from the ISSUER, which is `jwt.issuer ?? baseURL`. Those agree
   * today only because `jwt()` is configured without one. Giving the JWT plugin
   * a stable issuer — an ordinary thing to want, so that tokens verify the same
   * across stages — moves the plugin's alias and leaves this constant pointing
   * at a path nothing answers.
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
  });
});

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
});

describe("everything else stays with the app", () => {
  for (const pathname of [
    "/",
    "/sign-in",
    "/consent",
    "/avatars/abc",
    // Not a blanket `/.well-known/` forward — see `servedByAuth`.
    "/.well-known/apple-app-site-association",
    "/.well-known/security.txt",
    "/.well-known/assetlinks.json",
  ]) {
    test(`${pathname} → app`, () => {
      expect(servedByAuth(pathname)).toBe(false);
    });
  }
});
