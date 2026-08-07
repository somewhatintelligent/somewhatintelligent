/**
 * THE THREE LISTS THAT HAVE TO AGREE, pinned against the running configuration.
 *
 * `AUTH_SCOPES` decides what the server grants. From it follow two things this
 * repo maintains BY HAND, because the plugin offers no way to extend either:
 *
 *   - `advertisedMetadata.claims_supported`, which REPLACES the plugin's
 *     derived claims rather than adding to them, so `config.ts` restates the
 *     derivation.
 *   - `app/lib/scopes.ts`, the consent screen's labels, whose `?? scope`
 *     fallback renders an unlabelled scope as its raw id rather than failing.
 *
 * Both were already wrong once. `offline_access` had been granted and
 * unlabelled since the provider was configured, and the first attempt at
 * advertising `role` cut discovery from fourteen claims to one. Neither is
 * visible from reading `config.ts`, and neither breaks a build — so they are
 * asserted here, against `authOptions`, which is the same value the deployed
 * Worker resolves.
 *
 * In `test/` and not `integ/` deliberately: this is the class of mistake that
 * should cost a `vp test`, not a deploy.
 */

import type { BetterAuthOptions } from "better-auth";
import * as Effect from "effect/Effect";
import { describe, expect, test } from "vite-plus/test";

import { AUTH_SCOPES } from "../api/config.ts";
import { authOptions } from "../api/options.ts";
import { getScopeLabel } from "../app/lib/scopes.ts";

const options = await Effect.runPromise(authOptions);

/** The resolved plugin, by its own id — `config.ts` may reorder the array. */
const oauth = (options.plugins ?? []).find(
  (
    plugin,
  ): plugin is NonNullable<BetterAuthOptions["plugins"]>[number] & {
    options: {
      scopes?: ReadonlyArray<string>;
      advertisedMetadata?: { claims_supported?: string[] };
    };
  } => plugin.id === "oauth-provider",
);

describe("the granted scopes", () => {
  test("are the ones the plugin was configured with", () => {
    expect(oauth?.options.scopes).toEqual([...AUTH_SCOPES]);
  });

  /**
   * The consent screen is the only thing a user reads before granting, and an
   * unlabelled scope reaches it as a raw id — `offline_access`, not "Stay
   * signed in". `getScopeLabel` returning the input IS the miss.
   */
  test("all carry a human label on the consent screen", () => {
    const unlabelled = AUTH_SCOPES.filter((scope) => getScopeLabel(scope) === scope);
    expect(unlabelled).toEqual([]);
  });
});

describe("the advertised claims", () => {
  /**
   * The eight unconditional claims the plugin always derives, plus the ones
   * `AUTH_SCOPES` earns. Written out rather than imported from `config.ts` —
   * importing the value under test would assert it equals itself, which is the
   * mistake the first version of `test/ingress.test.ts` made.
   */
  const derived = [
    "sub",
    "iss",
    "aud",
    "exp",
    "iat",
    "sid",
    "scope",
    "azp",
    ...(AUTH_SCOPES.includes("email" as never) ? ["email", "email_verified"] : []),
    ...(AUTH_SCOPES.includes("profile" as never)
      ? ["name", "picture", "family_name", "given_name"]
      : []),
  ];

  /**
   * THE REGRESSION THIS FILE EXISTS FOR. `claims_supported` is
   * `advertisedMetadata?.claims_supported ?? claims ?? []` upstream — a
   * replace, not a merge, whatever the docs say. Advertising `role` alone
   * dropped all fourteen below, and an assertion that only looked for `role`
   * passed anyway.
   */
  test("keep every claim the plugin would have derived from the scopes", () => {
    expect(oauth?.options.advertisedMetadata?.claims_supported).toEqual(
      expect.arrayContaining(derived),
    );
  });

  test("and add the custom one both claim callbacks inject", () => {
    expect(oauth?.options.advertisedMetadata?.claims_supported).toContain("role");
  });
});
