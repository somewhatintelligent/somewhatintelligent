/**
 * A real Better Auth instance, built from this app's own configuration over an
 * in-memory store, so a test can ask it a question over HTTP.
 *
 * The point is that nothing here stands in for the thing under test.
 * `api/config.ts` is imported, not restated; the plugins, the rate limiter, the
 * hooks and the endpoints are the ones the Worker runs. Only what the
 * configuration is RESOLVED AGAINST is swapped — a store, an origin, a signing
 * secret, an audience list — because those are the deploy's answers and a test
 * has to be able to give its own.
 *
 * `Mail` and `EmailTemplates` come from `inertly`: they are tripwires that
 * throw if anything reaches them, which is the correct outcome for a suite that
 * should never send a message.
 */

import { memoryAdapter } from "better-auth/adapters/memory";
import { Database, makeHandler } from "lib.better-auth-effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { authConfig } from "../api/config.ts";
import { Signing } from "../api/capabilities.ts";
import { inertly } from "../api/inert.ts";
import { Origin } from "../api/origin.ts";
import { Resources } from "../api/resources.ts";

export const ORIGIN = "https://accounts.example.test";

/** mezes, as this instance is told to know it. */
export const MEZES_ORIGIN = "https://mezedes.example.test";
export const MEZES = `${MEZES_ORIGIN}/mcp`;

/**
 * The models a request through the auth handler can touch.
 *
 * The memory adapter has no schema, so a model it was not given throws "Model
 * not found" rather than reading as an empty table. That makes this list a
 * statement about what the code under test reaches for — `rateLimit` is on it
 * because `api/config.ts` turns rate limiting on explicitly, so every request
 * is counted before any route sees it.
 */
const MODELS = [
  "user",
  "session",
  "account",
  "verification",
  "jwks",
  "rateLimit",
  "oauthClient",
  "oauthConsent",
  "oauthAccessToken",
  "oauthRefreshToken",
] as const;

export interface AuthInstance {
  readonly ask: (pathname: string, init?: RequestInit) => Promise<Response>;
  /** A POST of JSON, which is the only media type the auth router accepts. */
  readonly post: (pathname: string, body: unknown) => Promise<Response>;
}

/**
 * One store, shared by every call on the returned pair, so a flow can be walked
 * a step at a time — register, then authorize as the client that registered.
 *
 * A fresh instance per FILE rather than per call, and never one shared between
 * files: a test that passes because of a row another left behind is a test that
 * proves nothing, and the rate limiter has a budget that two suites would
 * otherwise spend on each other.
 */
export const authInstance = (): AuthInstance => {
  const store: Record<string, Array<unknown>> = Object.fromEntries(
    MODELS.map((model) => [model, []]),
  );

  const capabilities = Layer.mergeAll(
    inertly,
    Layer.succeed(Database, {
      dialect: "sqlite" as const,
      betterAuthDatabase: memoryAdapter(store),
    }),
    Layer.succeed(Origin, { origin: ORIGIN, cookieDomain: null }),
    Layer.succeed(Signing, { secret: "tests-only-secret-not-a-real-one-at-all" }),
    Layer.succeed(Resources, { audiences: [MEZES] }),
  );

  const ask = (pathname: string, init?: RequestInit): Promise<Response> =>
    Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.flatMap(makeHandler(authConfig), ({ handle }) =>
            handle(new Request(`${ORIGIN}${pathname}`, init)),
          ),
          capabilities,
        ),
      ).pipe(Effect.orDie),
    );

  return {
    ask,
    post: (pathname, body) =>
      ask(pathname, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
};
