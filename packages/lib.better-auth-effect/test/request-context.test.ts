/**
 * Can a callback built by `makeRequestBoundary<R>()` actually REACH `R`?
 *
 * `R` entering the requirement channel says the configuration could have had
 * the service at BUILD time. What a callback needs is to reach it at RUN time,
 * out of the AsyncLocalStorage `enterRequest` installs — and that is the fiber
 * running `fetch`, which under a Worker carries none of the capability Layer.
 *
 * Those are different claims, and the type system was checking the first while
 * the doc promised the second.
 */

import { describe, expect, test } from "bun:test";
import type { BetterAuthOptions } from "better-auth";
import { Effect, Layer } from "effect";
import { Bae } from "../src/Base.ts";
import { makeBoundary, makeRequestBoundary } from "../src/Boundary.ts";
import { Mail } from "../src/Contract.ts";
import { makeHandler } from "../src/Handler.ts";
import { Ambient, ORIGIN, outbox, reset, SqliteBacking } from "./Backing.ts";

const migrate = (options: BetterAuthOptions) =>
  Effect.promise(async () => {
    const { getMigrations } = await import("better-auth/db/migration");
    await (await getMigrations(options)).runMigrations();
  });

const post = (path: string, body: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });

const creds = { name: "Ctx", email: "ctx@bae.test", password: "correct-horse-battery" };

/**
 * The shape a Worker actually runs, and the reason the first version of this
 * test was vacuous.
 *
 * `authWorker` provides the capability Layer around CONSTRUCTION and returns
 * `{ fetch }` as a value. The Worker runtime invokes that later, on a fiber
 * that has none of it. So the handler must be built inside the provide and then
 * invoked OUTSIDE it — a test that calls `handle` while still inside the
 * `Effect.provide` proves nothing, because the request fiber inherits it.
 */
const buildThenDetach = <O extends BetterAuthOptions, E, R>(
  build: Effect.Effect<Effect.Effect<O, E, never>, never, R>,
) =>
  Effect.gen(function* () {
    const options = yield* build;
    yield* migrate(yield* options);
    const { handle } = yield* makeHandler(options);
    return handle;
  });

const exercise = async (
  built: Effect.Effect<(request: Request) => Effect.Effect<Response, unknown>, unknown, never>,
) => {
  const handle = await Effect.runPromise(Effect.orDie(built));
  // A FRESH runPromise: no capability Layer anywhere on this fiber.
  const signUp = await Effect.runPromise(
    Effect.orDie(handle(post("/api/auth/sign-up/email", creds))),
  );
  const reset = await Effect.runPromise(
    Effect.exit(handle(post("/api/auth/request-password-reset", { email: creds.email }))),
  );
  return { signUp: signUp.status, reset };
};

describe("a request-boundary callback must reach its declared services", () => {
  const config = (kind: "request" | "isolate") =>
    Effect.gen(function* () {
      const bae = yield* Bae;
      const run =
        kind === "request" ? yield* makeRequestBoundary<Mail>() : yield* makeBoundary<Mail>();
      // The nesting is the subject: `buildThenDetach` takes the outer Effect,
      // builds it here, then runs the inner one on a fiber carrying no
      // capability Layer. Yielding it would build and run on the same fiber,
      // which is the thing these tests exist to tell apart.
      // oxlint-disable-next-line effecttsgo/return-effect-in-gen
      return bae.configure({
        appName: "ctx",
        telemetry: { enabled: false },
        emailAndPassword: {
          enabled: true,
          sendResetPassword: run.fn(() =>
            Effect.flatMap(Mail, (m) => m.send({ to: ["x@y.z"], subject: "s", text: "t" })),
          ),
        },
      });
    });

  test("makeBoundary reaches Mail from a detached request fiber", async () => {
    reset();
    const report = await exercise(
      buildThenDetach(config("isolate")).pipe(
        Effect.provide(Layer.mergeAll(SqliteBacking, Ambient)),
      ),
    );
    expect(report.signUp).toBe(200);
    // The outbox is the proof the callback reached the service, not the status.
    expect(outbox.length).toBe(1);
  });

  test("makeRequestBoundary<Mail> does too", async () => {
    reset();
    const report = await exercise(
      buildThenDetach(config("request")).pipe(
        Effect.provide(Layer.mergeAll(SqliteBacking, Ambient)),
      ),
    );
    expect(report.signUp).toBe(200);
    expect(outbox.length).toBe(1);
  });
});
