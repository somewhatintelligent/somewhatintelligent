/**
 * The derivation, against real Better Auth plugin objects rather than fixtures.
 *
 * A hand-written `{ id: "passkey" }` would pass whatever the real plugin's shape
 * turned out to be, so the assertions that matter here read ids off plugins
 * Better Auth itself constructed.
 */

import { describe, expect, test } from "vite-plus/test";
import type { BetterAuthOptions } from "better-auth";
import { admin, bearer, twoFactor } from "better-auth/plugins";
import { DEFAULT_BASE_PATH, deriveFeatures, hasPlugin, hasSocialProvider } from "../Features.ts";

describe("what a bare configuration reports", () => {
  test("nothing is on, and the base path is Better Auth's own default", () => {
    expect(deriveFeatures({})).toEqual({
      basePath: DEFAULT_BASE_PATH,
      emailAndPassword: false,
      socialProviders: [],
      plugins: [],
    });
  });

  // The presence of the block must not be read as the feature being on. The
  // comparison is `=== true` rather than truthiness because a configuration
  // built in plain JavaScript can carry an absent or non-boolean `enabled`,
  // which the type here cannot express.
  test("an emailAndPassword block that is off reads as off", () => {
    expect(deriveFeatures({ emailAndPassword: { enabled: false } }).emailAndPassword).toBe(false);
  });
});

describe("what it reads off a real configuration", () => {
  const options = {
    basePath: "/auth",
    emailAndPassword: { enabled: true },
    socialProviders: {
      apple: { clientId: "a", clientSecret: "s" },
      google: { clientId: "g", clientSecret: "s" },
    },
    plugins: [admin(), twoFactor(), bearer()],
  } satisfies BetterAuthOptions;

  test("social provider KEYS, in an array a render can iterate", () => {
    expect(deriveFeatures(options).socialProviders).toEqual(["apple", "google"]);
  });

  test("plugin ids come off the plugins Better Auth built", () => {
    expect(deriveFeatures(options).plugins).toEqual(["admin", "two-factor", "bearer"]);
  });

  test("the base path is carried through", () => {
    expect(deriveFeatures(options).basePath).toBe("/auth");
  });

  test("no secret is reachable: the derived value holds ids and booleans only", () => {
    const serialised = JSON.stringify(deriveFeatures(options));
    expect(serialised).not.toContain("clientSecret");
    expect(serialised).not.toContain('"s"');
  });
});

describe("the shape a UI branches on", () => {
  const features = deriveFeatures({
    emailAndPassword: { enabled: true },
    socialProviders: { apple: { clientId: "a", clientSecret: "s" } },
    plugins: [twoFactor()],
  });

  test("presence answers both questions a sign-in form asks", () => {
    expect(hasSocialProvider(features, "apple")).toBe(true);
    expect(hasSocialProvider(features, "github")).toBe(false);
    expect(hasPlugin(features, "two-factor")).toBe(true);
    expect(hasPlugin(features, "passkey")).toBe(false);
  });

  // The point of reporting ids rather than a closed vocabulary: a plugin this
  // package has never heard of still reaches the UI that knows what to do.
  test("an unknown plugin id is reported, not dropped", () => {
    const withCustom = deriveFeatures({
      plugins: [{ id: "acme-sso" }] as BetterAuthOptions["plugins"],
    });

    expect(withCustom.plugins).toEqual(["acme-sso"]);
  });
});

describe("the base path is normalised, because a client concatenates it", () => {
  test("a missing leading slash is added", () => {
    expect(deriveFeatures({ basePath: "auth" }).basePath).toBe("/auth");
  });

  test("an empty string falls back rather than producing a bare origin", () => {
    expect(deriveFeatures({ basePath: "" }).basePath).toBe(DEFAULT_BASE_PATH);
  });
});
