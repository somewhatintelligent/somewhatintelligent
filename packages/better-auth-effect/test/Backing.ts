/**
 * Test backings for the contract. Real where it matters, recording where the
 * point is to observe that the seam was crossed.
 *
 * `SqliteBacking` hands back a REAL `bun:sqlite` handle, which is one of the
 * values `betterAuth({ database })` accepts directly — the `BunDatabase` member
 * of the union. So the contract's rule ("a resolved value of
 * `NonNullable<BetterAuthOptions["database"]>`, never a coloured Effect") is
 * satisfied here with no façade, because a local SQLite handle is genuinely
 * isolate-scoped.
 *
 * `SqliteHandle` is a TEST-LOCAL tag. `DatabaseService` deliberately exposes
 * only the value Better Auth consumes, so there is no way back from the contract
 * to the underlying handle — and the whole point of `live.test.ts` is to query
 * the rows afterwards.
 */

import { Database as BunDatabase } from "bun:sqlite";
import { Context, Effect, Layer } from "effect";
import { Database, Mail, Sms, type MailMessage } from "../src/Contract.ts";

// ---------------------------------------------------------------------------
// A handle the tests can query with, alongside the contract value
// ---------------------------------------------------------------------------

interface SqliteHandleService {
  readonly db: BunDatabase;
}
export class SqliteHandle extends Context.Service<SqliteHandle, SqliteHandleService>()(
  "test/SqliteHandle",
) {}

const OpenSqlite: Layer.Layer<SqliteHandle> = Layer.effect(
  SqliteHandle,
  Effect.sync(() => {
    const db = new BunDatabase(":memory:", { create: true });
    db.run("PRAGMA foreign_keys = ON");
    return { db };
  }),
);

/**
 * One provide = one fresh in-memory database, shared by both tags.
 *
 * `Database` is derived FROM `SqliteHandle` rather than opening its own, and
 * Layer memoisation guarantees the two see the same handle within a single
 * `Effect.provide`. Two `new BunDatabase(":memory:")` calls are two unrelated
 * databases, so getting this wrong would have the tests querying an empty one
 * and passing vacuously.
 *
 * Across provides they are deliberately NOT shared: each test wants its own
 * database, and several sign the same email up.
 */
export const SqliteBacking: Layer.Layer<Database | SqliteHandle> = Layer.provideMerge(
  Layer.effect(
    Database,
    Effect.map(SqliteHandle, (handle) => ({
      dialect: "sqlite" as const,
      betterAuthDatabase: handle.db,
    })),
  ),
  OpenSqlite,
);

/**
 * A database that is TYPE-LEGAL and RUNTIME-BROKEN.
 *
 * kysely's `SqliteDatabase` — `{ close(): void; prepare(sql): SqliteStatement }` —
 * is a declared member of `BetterAuthOptions["database"]`. An object satisfying
 * exactly that interface passes the type checker and is then rejected by Better
 * Auth's duck-typing, which looks for `aggregate` / `fileControl` /
 * `createSession` / `open`, none of which the interface declares. So
 * `createKyselyAdapter` returns `kysely: null` and `getAdapter` throws.
 *
 * No cast and no `any`: the broken-ness is admitted by Better Auth's own union.
 * This is what makes the `$context`-forcing assertion non-vacuous.
 */
export const BrokenDatabase: Layer.Layer<Database> = Layer.succeed(Database, {
  dialect: "sqlite",
  betterAuthDatabase: {
    close: () => {},
    prepare: () => ({
      reader: false,
      all: () => [],
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
      iterate: () => [][Symbol.iterator](),
    }),
  },
});

// ---------------------------------------------------------------------------
// Recording seams — the async boundary is observable through these
// ---------------------------------------------------------------------------

export const outbox: MailMessage[] = [];
export const texted: string[] = [];
export const backgrounded: string[] = [];

export const reset = (): void => {
  outbox.length = 0;
  texted.length = 0;
  backgrounded.length = 0;
  idCounter = 0;
};

const RecordingMail: Layer.Layer<Mail> = Layer.succeed(Mail, {
  send: (message) => Effect.sync(() => void outbox.push(message)),
});

const RecordingSms: Layer.Layer<Sms> = Layer.succeed(Sms, {
  send: (to, body) => Effect.sync(() => void texted.push(`${to}|${body}`)),
});

/**
 * Deferred work, as a TEST-LOCAL tag.
 *
 * `bae` has no capability for this either: `advanced.backgroundTasks.handler`
 * is `Effect.addFinalizer` on the request scope, which alchemy's bridges close
 * into `ctx.waitUntil` on workerd and settle inline on Lambda. Recording it
 * here is what lets `boundary.test.ts` assert that `fnVoid` reached it.
 */
interface DeferredService {
  readonly waitUntil: (effect: Effect.Effect<void>) => Effect.Effect<void>;
}
export class Deferred extends Context.Service<Deferred, DeferredService>()("test/Deferred") {}

const RecordingDeferred: Layer.Layer<Deferred> = Layer.succeed(Deferred, {
  waitUntil: (effect) => Effect.tap(effect, () => Effect.sync(() => void backgrounded.push("ran"))),
});

// ---------------------------------------------------------------------------
// Ids — a TEST-LOCAL tag, filling `advanced.database.generateId`
// ---------------------------------------------------------------------------

/**
 * `bae` has no capability for this: `generateId` is an ordinary option a
 * deployment writes. It is a service here because these tests need the ids to
 * be recognisable, and because a service in a sync position is what the
 * `SuspendingIds` control below exercises.
 */
interface IdsService {
  readonly generate: (model: string, size?: number) => Effect.Effect<string>;
}
export class Ids extends Context.Service<Ids, IdsService>()("test/Ids") {}

export const ID_PREFIX = "seam_";
let idCounter = 0;

const PrefixedIds: Layer.Layer<Ids> = Layer.succeed(Ids, {
  generate: (model) =>
    Effect.sync(() => {
      idCounter += 1;
      return `${ID_PREFIX}${model}_${idCounter}`;
    }),
});

/**
 * The control for the sync boundary: a generator that SUSPENDS.
 *
 * Proves `fnSync`'s runtime backstop fires in a real Better Auth call path and
 * not only in a unit test — which is the whole reason the constraint is allowed
 * to be a runtime one. See `Boundary.fnSync`.
 */
export const SuspendingIds: Layer.Layer<Ids> = Layer.succeed(Ids, {
  generate: (model) => Effect.as(Effect.sleep("1 millis"), `${ID_PREFIX}${model}_x`),
});

// ---------------------------------------------------------------------------
// The rest of the seam
// ---------------------------------------------------------------------------

export const ORIGIN = "http://localhost:4321";

/** `baseURL` and `secret` are ordinary options now, so a suite writes them. */
export const TEST_SECRET = "bae-test-secret-not-a-real-credential-0123456789abcdef";

/** Everything except the Database — the part that does not change between runs. */
export const Ambient = Layer.mergeAll(RecordingMail, RecordingSms, RecordingDeferred, PrefixedIds);
