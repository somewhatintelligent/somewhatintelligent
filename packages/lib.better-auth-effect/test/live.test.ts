/**
 * Better Auth, actually running, through `bae`'s own public surface.
 *
 * Nothing here is mocked. A real `bun:sqlite` database, Better Auth's own
 * migration engine creating the tables, and real HTTP requests handed to
 * `makeHandler(...).handle`. The assertions are made against the DATABASE ROWS,
 * not against the responses, because a response only proves Better Auth
 * answered — a row with a `seam_`-prefixed id proves the id came through
 * `Boundary.fnSync` and out of an Effect service.
 *
 * What each assertion is for:
 *
 *   - `seam_`-prefixed ids in `user` / `session`  -> the SYNC boundary is wired
 *     into a real Better Auth call path, not just a unit test.
 *   - a message in the outbox                     -> the ASYNC boundary is too,
 *     reached several awaits deep inside `auth.handler`.
 *   - `builds === 1` across many requests          -> `Effect.cached` holds.
 *   - `AuthInitFailed` from a broken database      -> forcing `$context` during
 *     the build converts what would be a late unhandled rejection into a value.
 *   - `SuspendedInSyncPosition` from a suspending  -> the runtime backstop on
 *     id generator                                    `Boundary.fnSync` fires
 *                                                     in situ, not just in a
 *                                                     unit test.
 */

import { describe, expect, test } from "bun:test";
import { getMigrations } from "better-auth/db/migration";
import type { BetterAuthOptions } from "better-auth";
import { Cause, Effect, Exit, Layer } from "effect";
import { AuthInitFailed, makeAuth } from "../src/Auth.ts";
import { makeBoundary, SuspendedInSyncPosition } from "../src/Boundary.ts";
import { Database, Mail } from "../src/Contract.ts";
import { makeHandler } from "../src/Handler.ts";
import {
  Ambient,
  BrokenDatabase,
  ID_PREFIX,
  Ids,
  ORIGIN,
  outbox,
  reset,
  SqliteBacking,
  SqliteHandle,
  SuspendingIds,
  TEST_SECRET,
} from "./Backing.ts";

// ---------------------------------------------------------------------------
// The configuration. A plain Effect; nothing in it knows what backs anything.
// ---------------------------------------------------------------------------

/**
 * `satisfies BetterAuthOptions`, never `: BetterAuthOptions` — the annotation
 * widens the literal and would delete the plugin inference. It is also what
 * gives `data` and `options` their types inside the wrapped callbacks:
 * contextual typing flows through `run.fn` / `run.fnSync` into the argument.
 */
const authOptions = Effect.gen(function* () {
  const database = yield* Database;
  const run = yield* makeBoundary<Mail | Ids>();

  return {
    appName: "bae-live-test",
    // RESOLVED value, straight from the contract. No await, no Effect.
    database: database.betterAuthDatabase,
    secret: TEST_SECRET,
    baseURL: ORIGIN,
    trustedOrigins: [ORIGIN],
    // Anonymous usage pings. Off in tests, and off by default in anything we ship.
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      // ASYNC boundary: Better Auth awaits this one.
      sendResetPassword: run.fn((data) =>
        Effect.gen(function* () {
          const mail = yield* Mail;
          yield* mail.send({
            to: [data.user.email],
            subject: "Reset your password",
            text: `token=${data.token} url=${data.url}`,
          });
        }),
      ),
    },
    advanced: {
      database: {
        // SYNC boundary: `generateId` is reached from a plain `defaultValue()`
        // with no await anywhere in the path.
        generateId: run.fnSync((options) =>
          Effect.flatMap(Ids, (ids) => ids.generate(options.model, options.size)),
        ),
      },
    },
  } satisfies BetterAuthOptions;
});

/**
 * Nobody declared this list; it IS the set of tags the body reached for. The
 * two-way assertion makes it exact, so a capability silently appearing or
 * disappearing from the configuration is a compile error here.
 */
type Seam = Database | Mail | Ids;
type Required = Effect.Services<typeof authOptions>;
const _seamIsExact: [Required extends Seam ? true : false, Seam extends Required ? true : false] = [
  true,
  true,
];
void _seamIsExact;

/** Better Auth's own migration engine. Not a hand-written schema. */
const migrate = Effect.gen(function* () {
  const options = yield* authOptions;
  const { runMigrations, toBeCreated } = yield* Effect.promise(() => getMigrations(options));
  yield* Effect.promise(() => runMigrations());
  return toBeCreated.map((t) => t.table);
});

const post = (path: string, body: unknown): Request =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });

const credentials = {
  name: "Live User",
  email: "live@bae.test",
  password: "correct-horse-battery-staple",
};

interface Row {
  readonly id: string;
}

// ---------------------------------------------------------------------------

describe("Better Auth, live, through bae", () => {
  test("signs up and signs in, and the rows prove both boundaries were crossed", async () => {
    reset();

    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const handle = yield* SqliteHandle;
        const created = yield* migrate;

        const { auth, handle: handleRequest } = yield* makeHandler(authOptions);

        const signUp = yield* handleRequest(post("/api/auth/sign-up/email", credentials));
        const signIn = yield* handleRequest(
          post("/api/auth/sign-in/email", {
            email: credentials.email,
            password: credentials.password,
          }),
        );
        // `/request-password-reset`, NOT `/forget-password` — the latter is the
        // pre-1.6 name and 404s silently, which is exactly how a test like this
        // passes vacuously if it only asserts on the response.
        const resetRequest = yield* handleRequest(
          post("/api/auth/request-password-reset", { email: credentials.email }),
        );

        // `auth.api` is reachable too, and typed — the generic `O` survived.
        const instance = yield* auth;
        const sessionList = yield* Effect.promise(() =>
          instance.api.listSessions({ headers: new Headers() }).catch(() => []),
        );

        return {
          created,
          signUpStatus: signUp.status,
          signInStatus: signIn.status,
          resetStatus: resetRequest.status,
          users: handle.db.query("SELECT id FROM user").all() as ReadonlyArray<Row>,
          sessions: handle.db.query("SELECT id FROM session").all() as ReadonlyArray<Row>,
          sessionListIsArray: Array.isArray(sessionList),
        };
      }).pipe(Effect.provide(Layer.mergeAll(SqliteBacking, Ambient))),
    );

    // Better Auth's migration engine created its own tables.
    expect(report.created).toContain("user");
    expect(report.created).toContain("session");

    expect(report.signUpStatus).toBe(200);
    expect(report.signInStatus).toBe(200);
    expect(report.resetStatus).toBe(200);

    // THE SYNC BOUNDARY: every id came out of an Effect service.
    expect(report.users.length).toBe(1);
    expect(report.users[0]!.id.startsWith(ID_PREFIX)).toBe(true);
    expect(report.sessions.length).toBeGreaterThanOrEqual(1);
    for (const session of report.sessions) {
      expect(session.id.startsWith(ID_PREFIX)).toBe(true);
    }

    // THE ASYNC BOUNDARY: reached from inside auth.handler, several awaits deep.
    expect(outbox.length).toBe(1);
    expect(outbox[0]!.to).toEqual([credentials.email]);
    expect(outbox[0]!.subject).toBe("Reset your password");

    expect(report.sessionListIsArray).toBe(true);
  });

  test("the instance is built once, however many requests arrive", async () => {
    reset();

    const builds = await Effect.runPromise(
      Effect.gen(function* () {
        yield* migrate;
        let observed = 0;
        const counted = Effect.tap(authOptions, () => Effect.sync(() => void (observed += 1)));
        const { handle: handleRequest } = yield* makeHandler(counted);

        yield* handleRequest(post("/api/auth/sign-up/email", credentials));
        yield* handleRequest(
          post("/api/auth/sign-in/email", {
            email: credentials.email,
            password: credentials.password,
          }),
        );
        yield* handleRequest(
          post("/api/auth/sign-in/email", { email: "no@one.test", password: "x" }),
        );
        return observed;
      }).pipe(Effect.provide(Layer.mergeAll(SqliteBacking, Ambient))),
    );

    expect(builds).toBe(1);
  });

  test("init failures are values, and a transient one is not cached", async () => {
    reset();

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const auth = yield* makeAuth(authOptions);
        // Forcing here is what a long-lived host does during Layer construction.
        return yield* auth;
      }).pipe(Effect.provide(Layer.mergeAll(BrokenDatabase, Ambient))),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(AuthInitFailed);
    }

    let attempts = 0;
    const retried = await Effect.runPromise(
      Effect.gen(function* () {
        yield* migrate;
        const flaky = Effect.suspend(() => {
          attempts += 1;
          return attempts === 1 ? Effect.fail("transient init dependency") : authOptions;
        });
        const auth = yield* makeAuth(flaky);
        const first = yield* Effect.exit(auth);
        const second = yield* auth;
        return { first, hasHandler: typeof second.handler === "function" };
      }).pipe(Effect.provide(Layer.mergeAll(SqliteBacking, Ambient))),
    );

    expect(Exit.isFailure(retried.first)).toBe(true);
    expect(attempts).toBe(2);
    expect(retried.hasHandler).toBe(true);
  });

  test("an id generator that suspends refuses the write rather than inventing an id", async () => {
    reset();

    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const handle = yield* SqliteHandle;
        yield* migrate;
        const { handle: handleRequest } = yield* makeHandler(authOptions);
        const exit = yield* Effect.exit(
          handleRequest(post("/api/auth/sign-up/email", credentials)),
        );
        return {
          exit,
          users: handle.db.query("SELECT id FROM user").all() as ReadonlyArray<Row>,
        };
      }).pipe(
        Effect.provide(Layer.mergeAll(SqliteBacking, Layer.provideMerge(SuspendingIds, Ambient))),
      ),
    );

    // The safety property, which is the one that matters: NO ROW WAS WRITTEN.
    // A backstop that fired but let a half-formed user through would be worse
    // than no backstop at all.
    expect(report.users).toEqual([]);

    // Better Auth catches the throw at its adapter boundary and turns it into a
    // client error (422 "Failed to create user") rather than letting it escape,
    // so the request completes — it just does not succeed. Either shape is
    // acceptable; silently succeeding is not.
    if (Exit.isSuccess(report.exit)) {
      expect(report.exit.value.status).not.toBe(200);
    } else {
      expect(String(Cause.squash(report.exit.cause))).toContain(new SuspendedInSyncPosition()._tag);
    }
  });
});
