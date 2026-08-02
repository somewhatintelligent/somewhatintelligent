/**
 * Does the Effect-native mirror of `auth.api` classify what comes back?
 *
 * The mirror exists so an auth Worker can answer RPC, and the whole reason it
 * cannot just be `Effect.promise(() => auth.api.x())` is classification. Better
 * Auth throws an `APIError` for outcomes that are ANSWERS — 401 for no session,
 * 403 for a failed permission check, 400 for a duplicate — and a rejection
 * reaching Effect through `Effect.promise` is a DEFECT. A defect crossing
 * alchemy's RPC boundary is re-thrown raw and loses its tag, so a caller cannot
 * tell "you are not signed in" from "the database is gone".
 *
 * So the assertions here are all about which channel a thing lands in, and with
 * what identity once it gets there. `toFailure` is not exported — it is reached
 * the way a consumer reaches it, by making a call that fails.
 */

import { describe, expect, test } from "bun:test";
import { APIError } from "better-auth/api";
import { Cause, Effect, Exit } from "effect";
import { makeEffectAuth, AuthApiError, AuthApiDefect } from "../src/Api.ts";
import { Bae } from "../src/Base.ts";
import type { BaeConfigError } from "../src/ConfigError.ts";
import { Database } from "../src/Contract.ts";
import { SqliteBacking } from "./Backing.ts";

/** The smallest configuration that produces a real instance. */
const options = Effect.gen(function* () {
  const bae = yield* Bae;
  return yield* bae.configure({
    baseURL: "https://api-test.invalid",
    secret: "api-test-secret-long-enough-to-not-warn-abcdef",
    emailAndPassword: { enabled: true },
  });
});

type AuthOptions = Effect.Success<typeof options>;

type Mirror = Effect.Success<
  ReturnType<typeof makeEffectAuth<AuthOptions, BaeConfigError, Database>>
>;

const run = <A, E>(body: (auth: Mirror) => Effect.Effect<A, E>) =>
  Effect.runPromiseExit(
    Effect.scoped(
      Effect.flatMap(makeEffectAuth(options), body).pipe(Effect.provide(SqliteBacking)),
    ),
  );

describe("an APIError is an answer, not a defect", () => {
  test("a rejected call FAILS with AuthApiError carrying its status", async () => {
    // A WELL-FORMED call with no session, so the 401 comes from the endpoint
    // rather than from schema validation in front of it. Sending `body: {}`
    // instead lands in `AuthApiDefect`, which is correct — a request that never
    // reached the endpoint has no answer to report — and would make this test
    // pass for the wrong reason if the assertion were only "it failed".
    const exit = await run((auth) =>
      auth.api.changePassword({
        headers: new Headers(),
        body: { newPassword: "a-new-password-long-enough", currentPassword: "the-old-one" },
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;

    // The point: a typed failure, not a defect. A defect here would mean the
    // cause is a `Die` and the tag never reaches the caller.
    const failure = Cause.squash(exit.cause) as AuthApiError;

    expect(failure?._tag).toBe("AuthApiError");
    expect(failure?.message).toBe("Unauthorized");
    expect(typeof failure?.status).toBe("number");
    expect(failure?.status).toBeGreaterThanOrEqual(400);
  });

  test("a malformed call is a DEFECT — it never reached an endpoint", async () => {
    // The control for the test above: both fail, only one of them is an answer.
    // The malformed call has to be built through the untyped escape hatch,
    // because the mirror carries the endpoint's real body type and refuses `{}`
    // outright — which is the better outcome, and is why this reaches for the
    // cast rather than the assertion being weakened.
    const exit = await run((auth) =>
      (auth.api as unknown as Record<string, (a: unknown) => Effect.Effect<unknown, unknown>>)
        .changePassword!({ headers: new Headers(), body: {} }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect((Cause.squash(exit.cause) as AuthApiDefect)?._tag).toBe("AuthApiDefect");
  });

  test("`status` is the NUMBER, so a caller can compare without knowing the name", async () => {
    // `APIError["status"]` is `keyof typeof statusCodes | Status` — the name OR
    // the number. A consumer branching on it would have to handle "FORBIDDEN"
    // and 403 both, so the mirror keeps `statusCode` and nothing else.
    const error = new APIError("FORBIDDEN", { message: "nope", code: "NOT_ALLOWED" });
    expect(typeof error.statusCode).toBe("number");
    expect(error.statusCode).toBe(403);
  });
});

describe("what the mirror refuses", () => {
  test("an endpoint that does not exist on this configuration is a defect, not a 404", async () => {
    // Reaching for `listUsers` without the admin plugin is a WIRING bug — no
    // deployment recovers from it at run time — so it is `AuthApiDefect` rather
    // than something a caller is invited to handle.
    const exit = await run((auth) =>
      (auth.api as unknown as Record<string, () => Effect.Effect<unknown, unknown>>).listUsers!(),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const failure = Cause.squash(exit.cause) as AuthApiDefect;
    expect(failure?._tag).toBe("AuthApiDefect");
    expect(failure?.message).toContain("listUsers");
  });

  test("`then` is refused, so the mirror is never mistaken for a thenable", async () => {
    // A `get` trap answering `then` with a function would make this object
    // await-able, and anything that awaited or `Effect.succeed`ed it would try
    // to RESOLVE it instead of storing it.
    const exit = await run((auth) =>
      Effect.succeed((auth.api as unknown as Record<string, unknown>).then),
    );

    expect(exit).toMatchObject({ _tag: "Success" });
    if (Exit.isFailure(exit)) return;
    expect(exit.value).toBeUndefined();
  });
});
