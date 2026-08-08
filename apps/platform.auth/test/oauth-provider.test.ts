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
import { inertly } from "../api/inert.ts";
import { UNRESOLVED_ORIGIN } from "../api/origin.ts";
import { decodeAudiences, encodeAudiences, Resources } from "../api/resources.ts";
import { AUTH_BASE_PATH } from "../shared/ingress.ts";
import { mezesAudience, mezesOrigin } from "../shared/resources.ts";
import { MEZES_SCOPES, SCOPE_NAMES, scopeCopy } from "../shared/scopes.ts";

/** What the plugin normalises its options into, of which this asserts a corner. */
interface ProviderOptions {
  readonly scopes: ReadonlyArray<string>;
  readonly validAudiences?: ReadonlyArray<string>;
  readonly grantTypes: ReadonlyArray<string>;
  readonly allowDynamicClientRegistration?: boolean;
  readonly allowUnauthenticatedClientRegistration?: boolean;
  readonly disableJwtPlugin?: boolean;
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
const configure = (audiences: ReadonlyArray<string>): Promise<BetterAuthOptions> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(authConfig, Layer.mergeAll(inertly, Layer.succeed(Resources, { audiences }))),
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

const MEZES_HOST = "https://mezedes.example.test";
/** Written out rather than derived: the audience tests below check the derivation. */
const MEZES = `${MEZES_HOST}/mcp`;
const AUTH_ISSUER = `${UNRESOLVED_ORIGIN}${AUTH_BASE_PATH}`;

describe("what a self-registering client may ask for", () => {
  test("registration is open, and open to clients with no account behind them", async () => {
    const provider = providerOf(await configure([]));

    // Both, or neither works: the first opens the endpoint, the second is what
    // lets a client reach it with no session — and forces it to be public,
    // which is what makes PKCE mandatory on its authorize request.
    expect(provider.allowDynamicClientRegistration).toBe(true);
    expect(provider.allowUnauthenticatedClientRegistration).toBe(true);
  });

  test("no grant that issues a token without a person", async () => {
    const provider = providerOf(await configure([]));

    expect([...provider.grantTypes].sort()).toEqual(["authorization_code", "refresh_token"]);
    expect(provider.grantTypes).not.toContain("client_credentials");
  });

  test("every scope the server offers has words the consent screen can use", async () => {
    const provider = providerOf(await configure([]));

    expect([...provider.scopes].sort()).toEqual([...SCOPE_NAMES].sort());
    for (const scope of provider.scopes) expect(scopeCopy(scope)).not.toBeNull();
  });

  test("the mezes scopes are among them, or nothing can be granted for mezes", async () => {
    const provider = providerOf(await configure([]));

    for (const scope of Object.keys(MEZES_SCOPES)) expect(provider.scopes).toContain(scope);
  });

  test("`offline_access` is offered, because an agent outlives the browser tab", async () => {
    const provider = providerOf(await configure([]));

    expect(provider.scopes).toContain("offline_access");
  });

  test("the rate limiter is on, and said so rather than inferred", async () => {
    // `/oauth2/register` takes no credential. Better Auth would otherwise
    // decide whether to enforce its 5/60s on that endpoint — and every rule
    // beside it — from `NODE_ENV`, which nothing in this deploy sets.
    expect((await configure([])).rateLimit?.enabled).toBe(true);
  });
});

describe("what a token may be made out to", () => {
  test("the server's own issuer, always — `/oauth2/userinfo` is addressed by it", async () => {
    const provider = providerOf(await configure([]));

    expect(provider.validAudiences).toContain(AUTH_ISSUER);
  });

  test("a stage that serves mezes accepts `resource` for it", async () => {
    const provider = providerOf(await configure([MEZES]));

    expect(provider.validAudiences).toContain(MEZES);
  });

  test("a stage that serves nothing accepts nothing but its own issuer", async () => {
    const provider = providerOf(await configure([]));

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
    const provider = providerOf(await configure([]));

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
  test("survives the round trip", () => {
    const audiences = ["https://mezedes.example.test/mcp", "https://other.example.test/mcp"];

    expect(decodeAudiences(encodeAudiences(audiences))).toEqual(audiences);
  });

  test("reads an unset binding as a stage with no resources, not as a fault", () => {
    expect(decodeAudiences(undefined)).toEqual([]);
    expect(decodeAudiences("")).toEqual([]);
    expect(decodeAudiences("   ")).toEqual([]);
  });
});
