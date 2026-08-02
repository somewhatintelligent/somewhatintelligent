/**
 * Does the primitive work at RUNTIME — with a non-empty requirement channel, at
 * every arity, in both the async and the sync mode?
 *
 * The type-level half is `prototypes/full-surface`: 224 of 226 enumerated Better
 * Auth positions accept this wrapper's output, and the same file against
 * `Boundary<never>` produces 226 errors. That proves the SHAPES line up. This
 * file proves the wrapped callbacks, invoked exactly as Better Auth invokes
 * them, actually reach the services and return the right values.
 *
 * The callbacks below are written against `Contract.ts`'s real tags rather than
 * fixtures, so a change to the contract breaks this.
 */

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  enterRequest,
  makeBoundary,
  makeRequestBoundary,
  NoRequestInScope,
  SuspendedInSyncPosition,
} from "../src/Boundary.ts";
import { Mail, Sms } from "../src/Contract.ts";
import { Ambient, backgrounded, Deferred, Ids, outbox, reset, texted } from "./Backing.ts";

type Caps = Mail | Sms | Ids | Deferred;

/** Shaped like Better Auth's own `APIError`: a tagged subclass of `Error`. */
class DeliveryRefused extends Error {
  readonly _tag = "DeliveryRefused";
  constructor() {
    super("delivery refused");
  }
}

/** Build callbacks the way a config Effect would: services resolved, then wrapped. */
const callbacks = Effect.runSync(
  Effect.gen(function* () {
    const run = yield* makeBoundary<Caps>();

    return {
      // arity 2, async, discards result — the shape of every mail sender
      sendResetPassword: run.fn(
        (data: { user: { email: string }; url: string }, _request?: Request) =>
          Effect.gen(function* () {
            const mail = yield* Mail;
            yield* mail.send({ to: [data.user.email], subject: "Reset", text: data.url });
          }),
      ),

      // arity 1, async, returns a VALUE that flows back
      beforeCreate: run.fn((user: { email: string }) =>
        Effect.gen(function* () {
          const ids = yield* Ids;
          const generated = yield* ids.generate("user");
          return { data: { ...user, id: generated } };
        }),
      ),

      // arity 1, async, returns boolean — control flow
      beforeDelete: run.fn((user: { email: string }) =>
        Effect.succeed(user.email.endsWith("@allowed.test")),
      ),

      // arity 1, SYNC — the positions Better Auth never awaits
      generateId: run.fnSync((options: { model: string }) =>
        Effect.flatMap(Ids, (ids) => ids.generate(options.model)),
      ),

      // arity 1, void — fire and forget
      background: run.fnVoid((promise: Promise<unknown>) =>
        Effect.gen(function* () {
          const tasks = yield* Deferred;
          yield* tasks.waitUntil(Effect.promise(() => promise.then(() => undefined)));
        }),
      ),

      // sms, arity 1
      sendOtp: run.fn((data: { phoneNumber: string; code: string }) =>
        Effect.gen(function* () {
          const sms = yield* Sms;
          yield* sms.send(data.phoneNumber, `code ${data.code}`);
        }),
      ),

      // a body that FAILS — must reject, not resolve. `DeliveryRefused` extends
      // Error on purpose: that is the shape of Better Auth's own `APIError`, and
      // the claim under test is that such a value arrives INTACT rather than
      // wrapped in something no `instanceof` can match.
      failing: run.fn(() => Effect.fail(new DeliveryRefused())),

      // a body that SUSPENDS in a sync position — must throw, not lie
      suspendingSync: run.fnSync(() => Effect.as(Effect.sleep("10 millis"), "never gets here")),
    };
  }).pipe(Effect.provide(Ambient)),
);

describe("the boundary primitive, at every shape Better Auth uses", () => {
  test("arity-2 async sender reaches the service", async () => {
    reset();
    await callbacks.sendResetPassword({ user: { email: "a@b.test" }, url: "https://x/reset" });
    expect(outbox).toEqual([{ to: ["a@b.test"], subject: "Reset", text: "https://x/reset" }]);
  });

  test("a returned value flows back to Better Auth", async () => {
    reset();
    const result = await callbacks.beforeCreate({ email: "a@b.test" });
    expect(result).toEqual({ data: { email: "a@b.test", id: "seam_user_1" } });
  });

  test("a boolean control-flow return works", async () => {
    await expect(callbacks.beforeDelete({ email: "x@allowed.test" })).resolves.toBe(true);
    await expect(callbacks.beforeDelete({ email: "x@denied.test" })).resolves.toBe(false);
  });

  test("SYNC positions return a value with no await at all", () => {
    reset();
    // Deliberately NOT awaited — this is how Better Auth calls generateId.
    const id: string | false = callbacks.generateId({ model: "session" });
    expect(id).toBe("seam_session_1");
  });

  test("fnVoid forks and the task still runs", async () => {
    reset();
    callbacks.background(Promise.resolve("done"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backgrounded).toEqual(["ran"]);
  });

  test("sms sender", async () => {
    reset();
    await callbacks.sendOtp({ phoneNumber: "+15550100", code: "123456" });
    expect(texted).toEqual(["+15550100|code 123456"]);
  });

  test("a failed Effect REJECTS, preserving the Error (Better Auth turns it into an API error)", async () => {
    await expect(callbacks.failing()).rejects.toThrow("delivery refused");
  });

  test("a suspending Effect in a sync position throws loudly rather than lying", () => {
    expect(() => callbacks.suspendingSync()).toThrow(SuspendedInSyncPosition);
  });
});

describe("request scope", () => {
  const requestRun = Effect.runSync(makeRequestBoundary<never>());
  const whichRequest = requestRun.fn(() => Effect.succeed("ok"));

  test("refuses outside a request rather than answering with a stale context", async () => {
    await expect(whichRequest()).rejects.toThrow(NoRequestInScope);

    const fireAndForget = requestRun.fnVoid(() => Effect.void);
    expect(() => fireAndForget()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  test("resolves inside a request, and propagates across awaits", async () => {
    const result = await Effect.runPromise(
      enterRequest(async () => {
        await new Promise((r) => setTimeout(r, 1));
        return whichRequest();
      }),
    );
    expect(result).toBe("ok");
  });

  test("two concurrent requests do not read each other's context", async () => {
    const seen: string[] = [];
    const one = Effect.runPromise(
      enterRequest(async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(`a:${await whichRequest()}`);
      }),
    );
    const two = Effect.runPromise(
      enterRequest(async () => {
        seen.push(`b:${await whichRequest()}`);
      }),
    );
    await Promise.all([one, two]);
    expect(seen.sort()).toEqual(["a:ok", "b:ok"]);
  });
});
