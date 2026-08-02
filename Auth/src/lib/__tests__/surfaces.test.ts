/**
 * The list, pinned against the configuration the auth server actually runs.
 *
 * `SURFACES` maps a define suffix to a Better Auth plugin id, and a plugin id
 * is upstream's string — `two-factor`, not `twoFactor`. Nothing checks a typo
 * at compile time: `features.plugins.includes("twoFactor")` is `false`, the
 * define is `false`, and the surface silently disappears from the build. That
 * is the failure this file exists to make loud.
 */

import { deriveFeatures } from "better-auth-manifest";
import * as Effect from "effect/Effect";
import { describe, expect, test } from "vite-plus/test";

import { authOptions } from "../../../backend/options.ts";
import { authDefines, SOCIAL_PROVIDERS_FLAG, SURFACES } from "../../../surfaces.ts";

const options = await Effect.runPromise(authOptions);
const features = deriveFeatures(options);

describe("every declared surface is a plugin the deployment runs", () => {
  const running = features.plugins;

  for (const [flag, id] of Object.entries(SURFACES)) {
    test(`${flag} → "${id}"`, () => {
      expect(running).toContain(id);
    });
  }
});

describe("the projection", () => {
  const defines = authDefines(features);

  test("emits one entry per declared surface, and nothing else claiming to be one", () => {
    const emitted = Object.keys(defines).filter(
      (key) => key.startsWith("VITE_AUTH_") && key !== SOCIAL_PROVIDERS_FLAG,
    );

    expect(emitted.sort()).toEqual(
      [
        ...Object.keys(SURFACES).map((key) => `VITE_AUTH_${key}`),
        "VITE_AUTH_EMAIL_PASSWORD",
      ].sort(),
    );
  });

  test("every branchable define is a scalar, because only a scalar folds", () => {
    // A define is substituted as source text. Rolldown eliminates the dead
    // branch when the condition is a literal after the swap and does not when
    // it is a member access or a `JSON.parse` — measured, not assumed. So
    // anything the app branches on has to be a boolean here.
    for (const [key, value] of Object.entries(defines)) {
      if (key === SOCIAL_PROVIDERS_FLAG) continue;
      expect(typeof value).toBe("boolean");
    }
  });

  test("the iterable one stays an array", () => {
    expect(Array.isArray(defines[SOCIAL_PROVIDERS_FLAG])).toBe(true);
  });
});
