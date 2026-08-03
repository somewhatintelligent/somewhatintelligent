/**
 * Idempotency and audit, which are the same table doing both jobs — and that is
 * why the design works.
 *
 * v2 got this right and it is the most portable thing in its store. The
 * contract, in four parts:
 *
 *  1. Every mutating command begins with an idempotency lookup. A hit returns
 *     the ORIGINAL response verbatim and re-runs nothing.
 *  2. On success the domain mutation and exactly one event insert go into the
 *     SAME batch. Splitting them would let a mutation land with no idempotency
 *     record, and the next retry would mutate again.
 *  3. A typed-error return writes NO event, so a failed call stays retryable
 *     and a recorded row always means a success replay.
 *  4. A core may declare that some of its statements are CONDITIONAL — see
 *     {@link GuardedStatement}. Those are checked after the commit, and a guard
 *     that matched nothing removes the event row, which puts the call back under
 *     rule 3. Without it a response computed before the batch could be recorded
 *     as fact when the write it describes never happened.
 *
 * {@link command} is that whole protocol in one place, so no call site can
 * implement half of it. A core hands back the statements it wants committed and
 * the response it wants recorded; it never touches the database itself, which is
 * what keeps every domain module a pure function of its arguments.
 */
import { and, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { err, type DomainResult, type OperatorCall } from "../domain/Contracts.ts";
import { firstLostGuard } from "../core/guards.ts";
import { commandEvent } from "../domain/Schema.ts";
import { Database, query, type DbStatement } from "./Database.ts";
import { Ids } from "./Ids.ts";

export interface EventFacts {
  readonly targetType: string;
  /** The operator-facing handle: a product, variant or media id — for an order, its NUMBER. */
  readonly targetId: string;
  /** Identifiers and counts only. Never a body, a blob, or a secret. */
  readonly detail?: Record<string, unknown>;
}

/**
 * A statement whose WHERE clause is a PREDICATE, not just a row selector.
 *
 * A conditional UPDATE that matches nothing is a no-op, not an error — D1's
 * batch does not abort on it — so a core that emits one and assumes it took is
 * asserting something it never checked. Declaring the statement's index here
 * makes {@link Audit.command} inspect `meta.changes` after the commit and turn
 * a lost guard into the domain error the core would have returned had it known.
 *
 * The ledger row is REMOVED when a guard loses, so the call stays retryable —
 * that is the same contract as a core that returns a failure up front: a
 * recorded event always means a success worth replaying.
 */
export interface GuardedStatement<E extends string> {
  /** Position in `statements`. */
  readonly index: number;
  readonly error: E;
  readonly message?: string;
}

/**
 * What a domain core returns: either a committed outcome with its statements
 * and audit facts, or a typed domain failure that writes nothing.
 */
export type CoreOutcome<T, E extends string> =
  | {
      readonly statements: readonly DbStatement[];
      readonly response: { ok: true; value: T };
      readonly facts: EventFacts;
      /**
       * Statements that must each have changed exactly one row for `response`
       * to be true. Omit when every statement is unconditional.
       */
      readonly guards?: readonly GuardedStatement<E>[];
      /**
       * Run AFTER the batch commits — the escape hatch for an effect D1 cannot
       * hold, which in practice means deleting R2 objects behind a media delete.
       *
       * The ordering is deliberate and not symmetric. Commit first, then delete
       * bytes: a failure here leaks an unreferenced object, which costs storage
       * and nothing else. The reverse would leave a row pointing at bytes that
       * are already gone, which is a visibly broken product page. So this is
       * allowed to fail, and its failure is logged rather than propagated.
       */
      readonly onCommitted?: Effect.Effect<void, unknown>;
    }
  | { readonly failure: DomainResult<T, E> };

export class Audit extends Context.Service<
  Audit,
  {
    /**
     * Run a mutating command under the idempotency + audit protocol. Returns
     * the domain result, whether freshly computed or replayed.
     *
     * `R` is carried through rather than pinned to `never`: a core may need a
     * capability of its own — media deletion needs `Blobs` to drop the bytes
     * after its batch commits — and the protocol should not force those cores
     * to resolve their services early.
     */
    command<I, T, E extends string, R>(
      action: string,
      call: OperatorCall<I>,
      core: Effect.Effect<CoreOutcome<T, E>, never, R>,
    ): Effect.Effect<DomainResult<T, E>, never, R>;

    /**
     * The same protocol for a core that must run its OWN batch.
     *
     * The core is handed the ledger's claim statement and is REQUIRED to include
     * it in the first batch it commits. That is what makes the unique index
     * arbitrate the core's own mutation rather than a later one: two concurrent
     * requests with the same key both reach the batch, and exactly one commits.
     *
     * Checkout is the only caller, because it is the only core that has to
     * commit, inspect the result, and then call an external service before it
     * knows its response.
     */
    claimed<I, T, E extends string, R>(
      action: string,
      call: OperatorCall<I>,
      core: (claim: DbStatement) => Effect.Effect<CoreOutcome<T, E>, never, R>,
    ): Effect.Effect<DomainResult<T, E>, never, R>;
  }
>()("platform.commerce/services/Audit") {
  static readonly layer = Layer.effect(
    Audit,
    Effect.gen(function* () {
      const database = yield* Database;
      const ids = yield* Ids;
      const db = database.db;

      /** The recorded success response for this key + action, or null. */
      const recorded = Effect.fn("Audit.recorded")(function* (
        idempotencyKey: string,
        action: string,
      ) {
        const rows = yield* query(() =>
          db
            .select({ responseJson: commandEvent.responseJson })
            .from(commandEvent)
            .where(
              and(eq(commandEvent.idempotencyKey, idempotencyKey), eq(commandEvent.action, action)),
            )
            .limit(1),
        );
        const found = rows[0];
        if (!found) return { state: "none" } as const;
        /**
         * A row with no response is a CLAIM without a completion: another
         * attempt holds this key right now, or one died after claiming. Either
         * way the work must not be repeated — that is the entire purpose of the
         * claim — so this is reported separately from "never seen".
         */
        if (found.responseJson == null) return { state: "pending" } as const;
        return { state: "done", response: JSON.parse(found.responseJson) as unknown } as const;
      });

      const command = Effect.fn("Audit.command")(function* <I, T, E extends string>(
        action: string,
        call: OperatorCall<I>,
        core: Effect.Effect<CoreOutcome<T, E>>,
      ) {
        const replay = yield* recorded(call.meta.idempotencyKey, action);
        if (replay.state === "done") return replay.response as DomainResult<T, E>;
        if (replay.state === "pending") {
          return { ok: false, error: "in_progress" } as unknown as DomainResult<T, E>;
        }

        const outcome = yield* core;
        if ("failure" in outcome) return outcome.failure;

        const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
        const eventId = yield* ids.next();

        /**
         * The mutation and its event row in ONE batch. The unique index on
         * (idempotency_key, action) means a concurrent duplicate loses here
         * rather than mutating twice — the batch aborts on the constraint.
         */
        const results = yield* Effect.orDie(
          database.run([
            ...outcome.statements,
            db.insert(commandEvent).values({
              id: eventId,
              actorSub: call.meta.actor.sub,
              actorEmail: call.meta.actor.email,
              action,
              targetType: outcome.facts.targetType,
              targetId: outcome.facts.targetId,
              requestId: call.meta.requestId,
              idempotencyKey: call.meta.idempotencyKey,
              outcome: "success",
              detailJson: outcome.facts.detail ? JSON.stringify(outcome.facts.detail) : null,
              responseJson: JSON.stringify(outcome.response),
              createdAt: now,
            }) as unknown as DbStatement,
          ]),
        );

        /**
         * DID THE CONDITIONAL WRITES ACTUALLY TAKE?
         *
         * A guard that matched nothing left the row untouched while the event
         * row beside it committed — so without this the ledger records a
         * success for a mutation that never happened, and a later replay serves
         * that fiction back verbatim.
         *
         * The ledger row is deleted rather than rewritten, so the key stays
         * unconsumed and the caller may retry. That preserves the contract
         * stated at the top of this file: a recorded event always means a
         * success.
         *
         * NOT AIRTIGHT, and worth stating rather than implying. The delete is a
         * SECOND batch, so a process that dies between the two leaves a success
         * row for a mutation that never happened — and a replay would serve it.
         * That window cannot be closed from here: the mutation and its event
         * must commit together (invariant 2), and whether a guard took is only
         * knowable after they have. A core that cannot tolerate the window
         * should run its own batch through {@link claimed} instead, the way
         * checkout does.
         *
         * It is still strictly better than the alternative it replaced, which
         * recorded the fiction unconditionally rather than in a crash window.
         */
        const lost = firstLostGuard(outcome.guards, results);
        if (lost) {
          yield* Effect.orDie(
            database.run([
              db.delete(commandEvent).where(eq(commandEvent.id, eventId)) as unknown as DbStatement,
            ]),
          );
          return err(lost.error, lost.message) as DomainResult<T, E>;
        }

        /**
         * The row is gone and the audit event is written; only bytes remain.
         * A failure here is logged and swallowed — see the note on
         * `onCommitted` for why it must not fail the command.
         */
        if (outcome.onCommitted) {
          yield* outcome.onCommitted.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("store.audit.after_commit_failed", { action, cause }),
            ),
          );
        }

        return outcome.response as DomainResult<T, E>;
      });

      /**
       * CLAIM FIRST, for a core that must run its own batch.
       *
       * Checkout cannot hand its statements to {@link command}: it has to commit
       * the stock guards, inspect which ones won, and only then talk to the
       * payment provider. That left the reservation committed OUTSIDE the
       * ledger's batch, so two taps of Buy both missed `recorded()`, both
       * reserved, and the loser died on the unique index with its phantom hold
       * intact.
       *
       * Here the core is handed the claim statement and puts it in the SAME batch
       * as the reservation, so the unique index arbitrates the reservation itself.
       * The row is completed afterwards with the real response.
       */
      const claimed = Effect.fn("Audit.claimed")(function* <I, T, E extends string>(
        action: string,
        call: OperatorCall<I>,
        core: (claim: DbStatement) => Effect.Effect<CoreOutcome<T, E>>,
      ) {
        const replay = yield* recorded(call.meta.idempotencyKey, action);
        if (replay.state === "done") return replay.response as DomainResult<T, E>;
        if (replay.state === "pending") {
          return { ok: false, error: "in_progress" } as unknown as DomainResult<T, E>;
        }

        const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
        const eventId = yield* ids.next();

        /**
         * ON CONFLICT DO NOTHING, so losing the claim is a VALUE, not a throw.
         *
         * The core is required to put this in the first batch it commits, which
         * is what makes the unique index arbitrate that core's own mutation
         * rather than a later one. But a raw insert reports its loss as a
         * constraint violation — an exception carrying driver prose, which the
         * only caller then had to recognise by regex to tell "another request
         * holds this key" from "the database is broken".
         *
         * `DO NOTHING` turns that into `meta.changes === 0`: the same signal
         * every other conditional write in this codebase already uses, and one
         * no dependency bump can reword.
         *
         * The batch no longer aborts on a lost claim, so the core is responsible
         * for unwinding whatever committed beside it. `Checkout.placeOrder` does
         * that with the compensation path it already had.
         */
        const claim = db
          .insert(commandEvent)
          .values({
            id: eventId,
            actorSub: call.meta.actor.sub,
            actorEmail: call.meta.actor.email,
            action,
            targetType: "pending",
            targetId: "pending",
            requestId: call.meta.requestId,
            idempotencyKey: call.meta.idempotencyKey,
            outcome: "pending",
            detailJson: null,
            // Null until the command completes — this is what `recorded` reads to
            // tell a claim from a completion.
            responseJson: null,
            createdAt: now,
          })
          .onConflictDoNothing({
            target: [commandEvent.idempotencyKey, commandEvent.action],
          }) as unknown as DbStatement;

        const outcome = yield* core(claim);

        /**
         * A failed core leaves the claim behind deliberately. It is what stops a
         * retry re-running work whose side effects already committed, and the
         * reconcile sweep is what releases anything it stranded.
         */
        if ("failure" in outcome) {
          yield* Effect.orDie(
            database.run([
              db
                .update(commandEvent)
                .set({
                  outcome: "failure",
                  responseJson: JSON.stringify(outcome.failure),
                  targetType: "order",
                  targetId: "unknown",
                })
                .where(eq(commandEvent.id, eventId)) as unknown as DbStatement,
            ]),
          );
          return outcome.failure;
        }

        yield* Effect.orDie(
          database.run([
            ...outcome.statements,
            db
              .update(commandEvent)
              .set({
                outcome: "success",
                targetType: outcome.facts.targetType,
                targetId: outcome.facts.targetId,
                detailJson: outcome.facts.detail ? JSON.stringify(outcome.facts.detail) : null,
                responseJson: JSON.stringify(outcome.response),
              })
              .where(eq(commandEvent.id, eventId)) as unknown as DbStatement,
          ]),
        );

        if (outcome.onCommitted) {
          yield* outcome.onCommitted.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("store.audit.after_commit_failed", { action, cause }),
            ),
          );
        }

        return outcome.response as DomainResult<T, E>;
      });

      return Audit.of({ command, claimed });
    }),
  );
}
