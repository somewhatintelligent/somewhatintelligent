/**
 * The OAuth server, pinned against what it takes to be one an MCP client can
 * use without a human in the loop.
 *
 * Every assertion here is a step in the same flow: a coding agent reads mezes'
 * protected-resource metadata, follows it here, registers itself, sends someone
 * to a consent screen, and comes back with a token mezes can verify. Each one
 * fails silently in its own way — a missing scope reads as `invalid_scope` on a
 * URL nobody sees, a missing audience hands back an opaque token that mezes
 * rejects two hops later — which is why they are asserted on the CONFIGURATION
 * rather than left to be discovered against a live deploy.
 */

import type { BetterAuthOptions } from "better-auth";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, test } from "vite-plus/test";

import { authConfig } from "../api/config.ts";
import { authOptions } from "../api/options.ts";
import { inertly } from "../api/inert.ts";
import { Origin, UNRESOLVED_ORIGIN } from "../api/origin.ts";
import { decodeAudiences, encodeAudiences, Resources } from "../api/resources.ts";
import { AUTH_BASE_PATH } from "../shared/ingress.ts";
import { mezesAudience, mezesOrigin } from "../shared/resources.ts";
import { SCOPE_NAMES, scopeCopy } from "../shared/scopes.ts";

/** What the plugin normalises its options into, of which this asserts a corner. */
interface ProviderOptions {
  readonly scopes: ReadonlyArray<string>;
  readonly validAudiences?: ReadonlyArray<string>;
  readonly grantTypes: ReadonlyArray<string>;
  readonly allowDynamicClientRegistration?: boolean;
  readonly allowUnauthenticatedClientRegistration?: boolean;
  readonly disableJwtPlugin?: boolean;
  readonly advertisedMetadata?: { readonly claims_supported?: ReadonlyArray<string> };
  readonly loginPage: string;
  readonly consentPage: string;
}

/**
 * The configuration as it resolves on a stage that serves `audiences`.
 *
 * `Resources` is stated AFTER `inertly`, which also carries it: the deploy host
 * has no resources and says so, and a test about audiences has to be able to
 * say otherwise. If that precedence ever inverts, every audience assertion
 * below goes red rather than quiet — the empty list they would then see is not
 * a value any of them expect.
 */
const configure = (
  audiences: ReadonlyArray<string>,
  cookieDomain: string | null = null,
): Promise<BetterAuthOptions> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        authConfig,
        Layer.mergeAll(
          inertly,
          Layer.succeed(Resources, { audiences }),
          Layer.succeed(Origin, { origin: UNRESOLVED_ORIGIN, cookieDomain }),
        ),
      ),
    ).pipe(Effect.orDie),
  );

/**
 * `BetterAuthPlugin` does not declare `options` — plugins that carry their
 * resolved settings do so by convention — so the read goes through `unknown`.
 * The shape above is asserted by every test that follows: a rename upstream
 * lands as `undefined` here, and `undefined` is not what any of them expect.
 */
const providerOf = (options: BetterAuthOptions): ProviderOptions => {
  const plugin = options.plugins?.find((candidate) => candidate.id === "oauth-provider");
  if (!plugin) throw new Error("the oauth-provider plugin is not installed");
  return (plugin as unknown as { options: ProviderOptions }).options;
};

/**
 * The default stage, resolved ONCE.
 *
 * `inertly` already answers `Resources` with no audiences and `Origin` with
 * `UNRESOLVED_ORIGIN` and no cookie domain, so `authOptions` — which `api/`
 * memoises with `Effect.cached` expressly so its readers share one answer — IS
 * `configure([])`. Calling `configure` for it rebuilt the whole plugin set per
 * test. `configure` is still what the two stages that need an override use.
 */
const base = Effect.runPromise(authOptions).then(providerOf);

const MEZES_HOST = "https://mezedes.example.test";
/** Written out rather than derived: the audience tests below check the derivation. */
const MEZES = `${MEZES_HOST}/mcp`;
const AUTH_ISSUER = `${UNRESOLVED_ORIGIN}${AUTH_BASE_PATH}`;

describe("what a self-registering client may ask for", () => {
  test("registration is open, and open to clients with no account behind them", async () => {
    const provider = await base;

    // Both, or neither works: the first opens the endpoint, the second is what
    // lets a client reach it with no session — and forces it to be public,
    // which is what makes PKCE mandatory on its authorize request.
    expect(provider.allowDynamicClientRegistration).toBe(true);
    expect(provider.allowUnauthenticatedClientRegistration).toBe(true);
  });

  test("no grant that issues a token without a person", async () => {
    const provider = await base;

    expect([...provider.grantTypes].sort()).toEqual(["authorization_code", "refresh_token"]);
    expect(provider.grantTypes).not.toContain("client_credentials");
  });

  test("every scope the server offers has words the consent screen can use", async () => {
    const provider = await base;

    expect([...provider.scopes].sort()).toEqual([...SCOPE_NAMES].sort());
    for (const scope of provider.scopes) expect(scopeCopy(scope)).not.toBeNull();
  });

  test("the mezes scopes are among them, or nothing can be granted for mezes", async () => {
    // NAMED, not iterated off the map they come from — a loop over that map
    // agrees with itself after a scope is deleted, which is the one change
    // this test exists to catch.
    const provider = await base;

    expect(provider.scopes).toContain("mezes:read");
    expect(provider.scopes).toContain("mezes:write");
  });

  test("`offline_access` is offered, because an agent outlives the browser tab", async () => {
    const provider = await base;

    expect(provider.scopes).toContain("offline_access");
  });

  test("the rate limiter is on, and said so rather than inferred", async () => {
    // `/oauth2/register` takes no credential. Better Auth would otherwise
    // decide whether to enforce its 5/60s on that endpoint — and every rule
    // beside it — from `NODE_ENV`, which nothing in this deploy sets.
    expect((await Effect.runPromise(authOptions)).rateLimit?.enabled).toBe(true);
  });

  test("and counts against a client address it can trust", async () => {
    /**
     * Without a resolvable address every rule shares ONE bucket per path, and
     * a limit everybody shares is a limit anybody can spend: three failed
     * logins from a stranger would shut `/sign-in/email` for every user.
     *
     * `cf-connecting-ip` and nothing else. `x-forwarded-for` arrives from the
     * client, so accepting it would let an attacker mint a fresh bucket per
     * request — a limit that is worse than none, because it reads as enforced.
     */
    const advanced = (await Effect.runPromise(authOptions)).advanced;

    expect(advanced?.ipAddress?.ipAddressHeaders).toEqual(["cf-connecting-ip"]);
    expect(advanced?.ipAddress?.disableIpTracking).toBeFalsy();
  });

  test("without evicting the cookie domain that shares the same key", async () => {
    /**
     * `advanced` used to be spread in entirely or not at all, on whether the
     * stage had a cookie domain. `ipAddress` had to go in beside it, and the
     * lazy version of that edit drops `crossSubDomainCookies` — which only
     * PRODUCTION sets, so every stage a test runs on would have looked fine.
     */
    const advanced = (await configure([], ".example.test")).advanced;

    expect(advanced?.crossSubDomainCookies).toEqual({ enabled: true, domain: ".example.test" });
    expect(advanced?.ipAddress?.ipAddressHeaders).toEqual(["cf-connecting-ip"]);
  });
});

describe("the advertised claims", () => {
  /**
   * The eight claims the plugin always derives, plus the ones the scope list
   * earns: `email`/`email_verified` for `email`, four more for `profile`. The
   * mezes scopes earn none — they are not OIDC scopes.
   *
   * Written out rather than imported from `api/config.ts`. Importing the value
   * under test would assert it equals itself, which is the mistake the first
   * version of `test/ingress.test.ts` made.
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
    "email",
    "email_verified",
    "name",
    "picture",
    "family_name",
    "given_name",
  ];

  test("keep every claim the plugin would have derived from the scopes", async () => {
    // `claims_supported` is `advertisedMetadata?.claims_supported ?? claims ?? []`
    // upstream — a REPLACE, not a merge, whatever the docs say. Advertising
    // `role` alone dropped all fourteen of these, and an assertion that only
    // looked for `role` passed anyway.
    const provider = await base;

    expect(provider.advertisedMetadata?.claims_supported).toEqual(expect.arrayContaining(derived));
  });

  test("and add the custom one both claim callbacks inject", async () => {
    const provider = await base;

    expect(provider.advertisedMetadata?.claims_supported).toContain("role");
  });
});

describe("what a token may be made out to", () => {
  test("the server's own issuer, always — `/oauth2/userinfo` is addressed by it", async () => {
    const provider = await base;

    expect(provider.validAudiences).toContain(AUTH_ISSUER);
  });

  test("a stage that serves mezes accepts `resource` for it", async () => {
    const provider = providerOf(await configure([MEZES]));

    expect(provider.validAudiences).toContain(MEZES);
  });

  test("a stage that serves nothing accepts nothing but its own issuer", async () => {
    const provider = await base;

    expect(provider.validAudiences).toEqual([AUTH_ISSUER]);
  });

  test("the JWT plugin stays on, or an audience buys an unverifiable token", async () => {
    // `disableJwtPlugin` would make every access token opaque no matter what
    // `resource` said, and mezes has no way to check an opaque token but an
    // introspection call per request.
    expect(providerOf(await configure([MEZES])).disableJwtPlugin).toBeFalsy();
  });
});

describe("the pages the flow sends people to", () => {
  test("are the ones this app actually routes", async () => {
    const provider = await base;

    // `app/routes/_auth/sign-in.tsx` and `app/routes/_auth/consent.tsx`. The
    // `_auth` segment is a layout, not a path.
    expect(provider.loginPage).toBe("/sign-in");
    expect(provider.consentPage).toBe("/consent");
  });
});

describe("the mezes audience", () => {
  test("carries the MCP path, because the shell's URL is a different resource", () => {
    expect(mezesAudience(MEZES_HOST)).toBe(MEZES);
  });

  test("normalises what a stage hands over, so one trailing slash is not a second resource", () => {
    expect(mezesAudience(`${MEZES_HOST}/`)).toBe(MEZES);
  });

  test("refuses what is not an origin", () => {
    expect(mezesAudience("mezedes.example.test")).toBeNull();
    expect(mezesAudience("javascript:alert(1)")).toBeNull();
    expect(mezesAudience("")).toBeNull();
  });

  test("is derivable on production and nowhere else", () => {
    expect(mezesOrigin("production")).toBe("https://mezedes.somewhatintelligent.ca");
    expect(mezesOrigin("staging")).toBeNull();
    expect(mezesOrigin("dev_stoli")).toBeNull();
  });
});

describe("the binding that carries them", () => {
  test("is the space-separated form the audience list is written in", () => {
    // The FORMAT, not the round trip: `split(" ")` undoing `join(" ")` is a
    // property of the standard library, and asserting it proves nothing about
    // this module. What matters is that the wire form is what a reader outside
    // this file would expect.
    expect(encodeAudiences(["https://a.test/mcp", "https://b.test/mcp"])).toBe(
      "https://a.test/mcp https://b.test/mcp",
    );
  });

  test("reads an unset binding as a stage with no resources, not as a fault", () => {
    expect(decodeAudiences(undefined)).toEqual([]);
    expect(decodeAudiences("")).toEqual([]);
    expect(decodeAudiences("   ")).toEqual([]);
  });
});
