/**
 * The plugin, driven through a real Better Auth instance over HTTP.
 *
 * The claim is that a deployment mounting it answers the same value
 * `deriveFeatures` returns, at a real route. Asserting on the plugin object
 * would prove only that it was constructed; the request is what proves Better
 * Auth mounted it where the doc says.
 */

import { describe, expect, test } from "vite-plus/test";
import { betterAuth } from "better-auth";
import { admin, twoFactor } from "better-auth/plugins";
import { memoryAdapter } from "better-auth/adapters/memory";
import { deriveFeatures } from "../Features.ts";
import { manifest } from "../Plugin.ts";

const ORIGIN = "http://manifest.test";

const db = () => ({ user: [], session: [], account: [], verification: [] });

const instance = (plugin: ReturnType<typeof manifest>, basePath?: string) =>
  betterAuth({
    ...(basePath === undefined ? {} : { basePath }),
    baseURL: ORIGIN,
    secret: "ba-manifest-test-not-a-real-credential-0123456789",
    database: memoryAdapter(db()),
    telemetry: { enabled: false },
    emailAndPassword: { enabled: true },
    socialProviders: { apple: { clientId: "a", clientSecret: "s" } },
    plugins: [admin(), twoFactor(), plugin],
  });

/**
 * Structural on purpose: `Auth<Options>` is invariant in `Options`, so a
 * parameter typed `ReturnType<typeof betterAuth>` rejects every concrete
 * instance. Only `handler` is used here.
 */
const get = async (auth: { handler: (request: Request) => Promise<Response> }, path: string) =>
  auth.handler(new Request(`${ORIGIN}${path}`, { method: "GET" }));

describe("the mounted route", () => {
  test("answers under Better Auth's base path", async () => {
    const response = await get(instance(manifest()), "/api/auth/manifest");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      basePath: "/api/auth",
      emailAndPassword: true,
      socialProviders: ["apple"],
      plugins: ["admin", "two-factor", "manifest"],
    });
  });

  test("moves with the base path, because it is derived from the same option", async () => {
    const response = await get(instance(manifest(), "/auth"), "/auth/manifest");

    expect(response.status).toBe(200);
    expect((await response.json()).basePath).toBe("/auth");
  });

  test("takes a path of its own", async () => {
    const auth = instance(manifest({ path: "/.well-known/features" }));

    expect((await get(auth, "/api/auth/.well-known/features")).status).toBe(200);
    expect((await get(auth, "/api/auth/manifest")).status).toBe(404);
  });

  // Two implementations of one question is how they disagree. The route must be
  // the same function, not a second reading of the options.
  test("serves exactly what deriveFeatures returns for the same configuration", async () => {
    const auth = instance(manifest());
    const served = await (await get(auth, "/api/auth/manifest")).json();

    expect(served).toEqual(deriveFeatures(auth.options));
  });
});

describe("extend, for what cannot be derived", () => {
  test("adds a field the options do not carry", async () => {
    const auth = instance(
      manifest({ extend: (features) => ({ ...features, captchaSiteKey: "1x0000" }) }),
    );

    const served = await (await get(auth, "/api/auth/manifest")).json();
    expect(served.captchaSiteKey).toBe("1x0000");
    expect(served.plugins).toContain("two-factor");
  });
});

describe("the route is public, which is what a sign-in page needs", () => {
  test("no session, no cookie, still 200", async () => {
    const response = await get(instance(manifest()), "/api/auth/manifest");

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
