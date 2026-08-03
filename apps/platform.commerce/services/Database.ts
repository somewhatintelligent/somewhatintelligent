/**
 * The D1 seam, and why it is the CLASSIC drizzle handle rather than the Effect
 * one.
 *
 * `Drizzle.D1` (the `drizzle-orm/effect-d1` driver) looks like the right
 * default: its queries are already Effects, its client is deferred to first use
 * and memoised per execution, and it needs no `RuntimeContext` discharge. But it
 * exposes no `batch`, and its `transaction` is unusable on D1 — `@effect/sql-d1`
 * sets `transactionAcquirer` to
 * `Effect.die("transactions are not supported in D1")`.
 *
 * Since a batch is the only atomicity primitive there is, everything that
 * mutates has to go through the classic handle — and once reads sit beside
 * those writes there is nothing left for a second handle to do. So the store
 * carries ONE, and `Drizzle.D1` is not used at all.
 *
 * Two invariants depend on batching outright:
 *
 *  - AUDIT: the domain mutation and its `command_event` insert commit
 *    together, or neither does.
 *  - RESERVATION: per-statement `meta.changes` is the only trustworthy signal
 *    that a guarded conditional UPDATE actually matched a row.
 *
 * THE RAW BINDING IS A PER-EVENT VALUE. `d1.raw` carries a `RuntimeContext`
 * requirement and that context does not exist in a Worker's init closure — it
 * is established per event. So this is a Layer, built inside handlers. That is
 * why no `uncoloured` / `RuntimeContext.phantom` discharge appears anywhere in
 * this codebase.
 */
import type { D1Database } from "@cloudflare/workers-types";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export type ClassicDb = ReturnType<typeof drizzle>;
export type DbStatement = BatchItem<"sqlite">;

/** The one field of a batch result the domain reads. */
interface StatementResult {
  readonly meta?: { readonly changes?: number };
}

class BatchFailed extends Schema.TaggedErrorClass<BatchFailed>()("BatchFailed", {
  message: Schema.String,
}) {}

/**
 * Drizzle's `batch` demands a NON-EMPTY tuple while every domain core builds its
 * statement list dynamically, so the emptiness check lives here once.
 */
const isNonEmpty = (
  statements: readonly DbStatement[],
): statements is readonly [DbStatement, ...DbStatement[]] => statements.length > 0;

export class Database extends Context.Service<
  Database,
  {
    /** The classic handle, for reads that sit beside a write. */
    readonly db: ClassicDb;
    /** Commit a dynamically-built statement list as ONE transaction. */
    run(statements: readonly DbStatement[]): Effect.Effect<readonly StatementResult[], BatchFailed>;
  }
>()("platform.commerce/services/Database") {
  /**
   * `raw` stays an Effect so its `RuntimeContext` requirement is carried by the
   * Layer rather than forced at init.
   */
  static readonly layer = <E, R>(raw: Effect.Effect<D1Database, E, R>) =>
    Layer.effect(
      Database,
      Effect.gen(function* () {
        const binding = yield* raw;
        const db = drizzle(binding);

        const run = Effect.fn("Database.run")(function* (statements: readonly DbStatement[]) {
          if (!isNonEmpty(statements)) return [] as readonly StatementResult[];
          return yield* Effect.tryPromise({
            try: () => db.batch(statements) as unknown as Promise<readonly StatementResult[]>,
            catch: (cause) =>
              new BatchFailed({
                message: cause instanceof Error ? cause.message : String(cause),
              }),
          });
        });

        return Database.of({ db, run });
      }),
    );
}

/** Await a classic drizzle query builder. A rejection is infrastructure, not a domain condition. */
export const query = <A>(build: () => PromiseLike<A>): Effect.Effect<A> =>
  Effect.promise(() => build() as Promise<A>);
