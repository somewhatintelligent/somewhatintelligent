/**
 * Does `Bae` actually produce a working configuration — and does the
 * plugin surface survive being spread into?
 *
 * The type-level half is `scripts/probe-optional-wiring.ts`. This is the
 * runtime half: real SQLite, real Better Auth, real requests, asserted on rows.
 */

import { describe, expect, test } from "bun:test";
import { admin, captcha } from "better-auth/plugins";
import type { BetterAuthOptions } from "better-auth";
import { Cause, Effect, Exit, Layer, type Scope } from "effect";
import { Bae } from "../src/Base.ts";
import { enterRequest, makeBoundary, makeRequestBoundary, waitUntil } from "../src/Boundary.ts";
import { CapabilityPluginConflict, RateLimitStorageConflict } from "../src/ConfigError.ts";
import {
  Captcha,
  Database,
  Mail,
  type RateLimitRow,
  RateLimitStorage,
  SecondaryStore,
} from "../src/Contract.ts";
import { makeHandler } from "../src/Handler.ts";
import {
  Ambient,
  ORIGIN,
  outbox,
  reset,
  SqliteBacking,
  SqliteHandle,
  TEST_SECRET,
} from "./Backing.ts";

/** The terse form: five keys you no longer write, and a plugin. */
const options = Effect.gen(function* () {
  const bae = yield* Bae;
  const run = yield* makeBoundary<Mail>();

  return yield* bae.configure({
    appName: "bae-base-test",
    baseURL: ORIGIN,
    secret: TEST_SECRET,
    telemetry: { enabled: false },
    plugins: [admin()],
    emailAndPassword: {
      enabled: true,
      sendResetPassword: run.fn((data) =>
        Effect.flatMap(Mail, (mail) =>
          mail.send({ to: [data.user.email], subject: "Reset", text: data.token }),
        ),
      ),
    },
  });
});

/** `SecondaryStore` must NOT be in R — it is read optionally. */
type Required = Effect.Services<typeof options>;
type Expected = Database | Mail;
const _exact: [Required extends Expected ? true : false, Expected extends Required ? true : false] =
  [true, true];
void _exact;
const _storeNotRequired: SecondaryStore extends Required ? false : true = true;
void _storeNotRequired;

const await_ = <A>(v: A | Promise<A>): Promise<A> => Promise.resolve(v);

const post = (path: string, body: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });

const credentials = {
  name: "Base User",
  email: "base@bae.test",
  password: "correct-horse-battery",
};

describe("Bae", () => {
  test("supplies the boilerplate, and Better Auth actually runs on it", async () => {
    reset();
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const handle = yield* SqliteHandle;
        const resolved = yield* options;
        yield* Effect.promise(async () => {
          const { getMigrations } = await import("better-auth/db/migration");
          const m = await getMigrations(resolved);
          await m.runMigrations();
        });

        const { auth, handle: handleRequest } = yield* makeHandler(options);
        const signUp = yield* handleRequest(post("/api/auth/sign-up/email", credentials));
        yield* handleRequest(
          post("/api/auth/request-password-reset", { email: credentials.email }),
        );

        const instance = yield* auth;
        return {
          status: signUp.status,
          users: handle.db.query("SELECT id, email FROM user").all() as ReadonlyArray<{
            email: string;
          }>,
          // The money assertion: the ADMIN plugin's endpoints survived `configure`.
          hasSetRole: typeof instance.api.setRole === "function",
          hasListUsers: typeof instance.api.listUsers === "function",
          // And the base really did supply these — they are not in the literal.
          baseURL: resolved.baseURL,
          hasSecret: resolved.secret.length > 0,
          secondaryStorage: resolved.secondaryStorage,
        };
      }).pipe(Effect.provide(Layer.mergeAll(SqliteBacking, Ambient))),
    );

    expect(report.status).toBe(200);
    expect(report.users.map((u) => u.email)).toEqual([credentials.email]);
    expect(report.hasSetRole).toBe(true);
    expect(report.hasListUsers).toBe(true);
    expect(report.baseURL).toBe(ORIGIN);
    expect(report.hasSecret).toBe(true);
    // No SecondaryStore Layer provided, so the key is present and undefined —
    // which Better Auth treats as "not configured".
    expect(report.secondaryStorage).toBeUndefined();
    expect(outbox.length).toBe(1);
  });

  test("providing SecondaryStore makes the key appear, without entering R", async () => {
    reset();
    const Kv = Layer.succeed(SecondaryStore, {
      get: () => Effect.succeed("cached"),
      set: () => Effect.void,
      delete: () => Effect.void,
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const resolved = yield* options;
        const storage = resolved.secondaryStorage;
        return {
          present: storage !== undefined,
          // The adapted methods really reach the Effect service.
          roundTrip: storage === undefined ? null : await_(storage.get("k")),
        };
      }).pipe(Effect.provide(Layer.mergeAll(SqliteBacking, Ambient, Kv))),
    );

    expect(result.present).toBe(true);
    expect(await result.roundTrip).toBe("cached");
  });
});

describe("Captcha auto-wires through serviceOption", () => {
  const Turnstile = Layer.succeed(Captcha, {
    provider: "cloudflare-turnstile" as const,
    secretKey: "test-secret",
  });

  const ids = (layer: Layer.Layer<Database>): Promise<string[]> =>
    Effect.runPromise(
      Effect.flatMap(Bae, (bae) =>
        Effect.map(bae.configure({ plugins: [admin()] }), (o): string[] =>
          (o.plugins ?? []).map((p) => p.id),
        ),
      ).pipe(Effect.provide(layer)),
    );

  test("no Captcha Layer means no captcha plugin, and it is not required", async () => {
    expect(await ids(Layer.mergeAll(SqliteBacking, Ambient))).toEqual(["admin"]);
  });

  // Order is the claim, not just membership: auto-wired plugins go FIRST, so a
  // captcha challenge is checked before another plugin's request hook runs.
  test("providing one puts the real plugin in, ahead of the caller's", async () => {
    expect(await ids(Layer.mergeAll(SqliteBacking, Ambient, Turnstile))).toEqual([
      "captcha",
      "admin",
    ]);
  });

  test("the auto-wired plugin is configured from the service, not from defaults", async () => {
    const configured = await Effect.runPromise(
      Effect.gen(function* () {
        const bae = yield* Bae;
        // Read through Better Auth's own view. `configure({})` has no `plugins`
        // in its TYPE — the auto-wired ones are deliberately not in `O` — so
        // this is the honest way to see what the value carries.
        const configured: BetterAuthOptions = yield* bae.configure({});
        const wired = configured.plugins ?? [];
        return wired[0]?.options as { provider?: string; secretKey?: string } | undefined;
      }).pipe(Effect.provide(Layer.mergeAll(SqliteBacking, Ambient, Turnstile))),
    );

    expect(configured?.provider).toBe("cloudflare-turnstile");
    expect(configured?.secretKey).toBe("test-secret");
  });

  // Two captcha plugins means verifying a single-use token twice, so every
  // challenged request is refused. Better Auth would run both and say nothing.
  test("passing the same plugin by hand is refused rather than run twice", async () => {
    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.flatMap(Bae, (bae) =>
          bae.configure({
            plugins: [captcha({ provider: "cloudflare-turnstile", secretKey: "mine" })],
          }),
        ).pipe(Effect.provide(Layer.mergeAll(SqliteBacking, Ambient, Turnstile))),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
    expect((error as CapabilityPluginConflict)._tag).toBe("CapabilityPluginConflict");
    expect((error as CapabilityPluginConflict).id).toBe("captcha");
  });

  // The control: the same plugin is fine when no capability wired one.
  test("…and is accepted when no Captcha Layer is in scope", async () => {
    expect(
      await Effect.runPromise(
        Effect.flatMap(Bae, (bae) =>
          Effect.map(
            bae.configure({
              plugins: [captcha({ provider: "cloudflare-turnstile", secretKey: "mine" })],
            }),
            (o): string[] => (o.plugins ?? []).map((p) => p.id),
          ),
        ).pipe(Effect.provide(Layer.mergeAll(SqliteBacking, Ambient))),
      ),
    ).toEqual(["captcha"]);
  });

  test("Captcha never enters the requirement channel", () => {
    // `serviceOption` is what makes an optional capability optional: a
    // deployment without a captcha simply does not provide the Layer, and that
    // is a choice rather than a missing dependency.
    type R = Effect.Services<typeof Bae>;
    const _captchaIsOptional: Captcha extends R ? false : true = true;
    void _captchaIsOptional;
    expect(true).toBe(true);
  });
});

describe("deferred work is an ordinary option, written on the request scope", () => {
  test("closing the scope waits for work Better Auth handed over", async () => {
    let settled = false;
    // Better Auth hands over an ALREADY-RUNNING promise, so what `waitUntil`
    // buys is not deferral — it is that the scope does not close without it.
    const outstanding = new Promise<void>((resolve) =>
      setTimeout(() => {
        settled = true;
        resolve();
      }, 30),
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const run = yield* makeRequestBoundary<Scope.Scope>();
          const handler = waitUntil(run);

          yield* enterRequest(async () => handler(outstanding));

          // The handler returned immediately: this is the response path.
          expect(settled).toBe(false);
        }),
      ),
    );

    // …and the scope did not close until the work was done.
    expect(settled).toBe(true);

    // Rejection is observed immediately and logged at scope close; it is not a
    // scope-close defect and does not leak as an unhandled Promise.
    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const run = yield* makeRequestBoundary<Scope.Scope>();
            const handler = waitUntil(run);
            yield* enterRequest(async () => handler(Promise.reject(new Error("send failed"))));
          }),
        ),
      ),
    ).resolves.toBeUndefined();
  });

  test("configure supplies no `advanced` at all — it is yours, untouched", async () => {
    const configured = await Effect.runPromise(
      Effect.flatMap(Bae, (bae) =>
        bae.configure({ advanced: { database: { defaultFindManyLimit: 50 } } }),
      ).pipe(Effect.provide(SqliteBacking)),
    );

    expect(configured.advanced).toEqual({ database: { defaultFindManyLimit: 50 } });
  });
});

describe("RateLimitStorage wires customStorage, and the conflict is refused", () => {
  const rows = new Map<string, RateLimitRow>();
  const Atomic = Layer.succeed(RateLimitStorage, {
    get: (key) => Effect.sync(() => rows.get(key) ?? null),
    set: (key, value) => Effect.sync(() => void rows.set(key, value)),
    consume: () => Effect.succeed({ allowed: true, retryAfter: null }),
  });
  /** Cloudflare KV's shape: no atomic path, so the key must be ABSENT. */
  const NonAtomic = Layer.succeed(RateLimitStorage, {
    get: (key) => Effect.sync(() => rows.get(key) ?? null),
    set: (key, value) => Effect.sync(() => void rows.set(key, value)),
  });

  const configured = (layer: Layer.Layer<Database>) =>
    Effect.runPromise(Effect.flatMap(Bae, (bae) => bae.configure({})).pipe(Effect.provide(layer)));

  test("no Layer means no customStorage, and Better Auth keeps its own default", async () => {
    const options = await configured(Layer.mergeAll(SqliteBacking, Ambient));
    expect(options.rateLimit).toBeUndefined();
  });

  test("a Layer lands on rateLimit.customStorage, adapted to promises", async () => {
    rows.clear();
    const options = await configured(Layer.mergeAll(SqliteBacking, Ambient, Atomic));
    const storage = options.rateLimit?.customStorage;

    expect(storage).toBeDefined();
    await await_(storage!.set("k", { key: "k", count: 1, lastRequest: 7 }));
    expect(await await_(storage!.get("k"))).toEqual({ key: "k", count: 1, lastRequest: 7 });
    expect(await await_(storage!.consume!("k", { window: 60, max: 2 }))).toEqual({
      allowed: true,
      retryAfter: null,
    });
  });

  // Better Auth BRANCHES on `consume` being present, so a stub would claim an
  // atomicity KV cannot give and silently turn a rate limit into a suggestion.
  test("a backing without consume produces a customStorage without the key", async () => {
    const options = await configured(Layer.mergeAll(SqliteBacking, Ambient, NonAtomic));
    expect(Object.keys(options.rateLimit!.customStorage!).toSorted()).toEqual(["get", "set"]);
  });

  test("writing rateLimit.storage as well is refused, naming the value", async () => {
    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.flatMap(Bae, (bae) => bae.configure({ rateLimit: { storage: "database" } })).pipe(
          Effect.provide(Layer.mergeAll(SqliteBacking, Ambient, Atomic)),
        ),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
    expect((error as RateLimitStorageConflict)._tag).toBe("RateLimitStorageConflict");
    expect((error as RateLimitStorageConflict).storage).toBe("database");
  });

  // Both controls: the same option with no Layer, and the same Layer with no
  // option. Without these the refusal above could be firing on either alone.
  test("…and is accepted with no Layer, or with no storage written", async () => {
    const withoutLayer = await Effect.runPromise(
      Effect.flatMap(Bae, (bae) => bae.configure({ rateLimit: { storage: "database" } })).pipe(
        Effect.provide(Layer.mergeAll(SqliteBacking, Ambient)),
      ),
    );
    expect(withoutLayer.rateLimit?.storage).toBe("database");

    const withoutOption = await configured(Layer.mergeAll(SqliteBacking, Ambient, Atomic));
    expect(withoutOption.rateLimit?.customStorage).toBeDefined();
  });

  test("policy stays the caller's, and rides alongside the capability", async () => {
    const options = await Effect.runPromise(
      Effect.flatMap(Bae, (bae) =>
        bae.configure({ rateLimit: { enabled: true, window: 30, max: 5 } }),
      ).pipe(Effect.provide(Layer.mergeAll(SqliteBacking, Ambient, Atomic))),
    );

    expect(options.rateLimit?.window).toBe(30);
    expect(options.rateLimit?.max).toBe(5);
    expect(options.rateLimit?.customStorage).toBeDefined();
  });

  test("RateLimitStorage stays out of the requirement channel", () => {
    type R = Effect.Services<typeof Bae>;
    const _optional: RateLimitStorage extends R ? false : true = true;
    void _optional;
    expect(true).toBe(true);
  });
});
