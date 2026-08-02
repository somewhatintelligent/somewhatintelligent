/**
 * The list, pinned against the configuration the auth server actually runs.
 *
 * A plugin id is upstream's string — `two-factor`, not `twoFactor` — and
 * nothing checks a typo at compile time: `plugins.includes("twoFactor")` is
 * `false`, the define is `false`, and the surface silently disappears from the
 * build. That is the failure this file exists to make loud.
 */

import { deriveFeatures } from "lib.better-auth-manifest";
import * as Effect from "effect/Effect";
import { describe, expect, test } from "vite-plus/test";

import { authOptions } from "../api/options.ts";
import { authDefines, SURFACES } from "../shared/surfaces.ts";

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
      (key) => key.startsWith("VITE_AUTH_") && key !== "VITE_AUTH_SOCIAL_PROVIDERS",
    );

    expect(emitted.sort()).toEqual(
      [
        ...Object.keys(SURFACES).map((key) => `VITE_AUTH_${key}`),
        "VITE_AUTH_EMAIL_PASSWORD",
      ].sort(),
    );
  });

  test("every branchable define is a scalar, because only a scalar folds", () => {
    for (const [key, value] of Object.entries(defines)) {
      if (key === "VITE_AUTH_SOCIAL_PROVIDERS") continue;
      expect(typeof value).toBe("boolean");
    }
  });

  test("the iterable one stays an array", () => {
    expect(Array.isArray(defines.VITE_AUTH_SOCIAL_PROVIDERS)).toBe(true);
  });
});
