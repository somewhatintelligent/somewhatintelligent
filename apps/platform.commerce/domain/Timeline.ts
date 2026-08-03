/**
 * What happened to one order, in order.
 *
 * THE PROBLEM. Everything an order went through is already recorded — but in two
 * tables that do not join. `command_event` keys on the order NUMBER,
 * because that is what an operator names; `payment_event` keys on the internal
 * id, because that is what the provider's metadata carries. So "when did we get
 * paid, and when did we set the tracking number, and who did it" is answerable
 * only by opening both and merging them by hand.
 *
 * This is that merge, done once. It is a READ over two append-only logs — it
 * derives nothing, corrects nothing, and is not a projection that can drift.
 * That is the whole reason it is cheap: the store is not event-sourced, but its
 * audit trail is append-only, so the history is already there to read.
 *
 * WHY IT IS WORTH HAVING. The order row holds only the LATEST value of every
 * field. A corrected tracking number overwrites the one that was actually
 * emailed to a customer; a refund overwrites the fact that money once arrived.
 * The logs keep both, and this is what makes them reachable.
 */
import { and, asc, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { query, type ClassicDb } from "../services/Database.ts";
import { actorKind } from "../core/actors.ts";
import { customerOrder, commandEvent, paymentEvent } from "./Schema.ts";

/**
 * Which log an entry came from, and — for the command ledger — WHO.
 *
 * The distinction is not cosmetic: `operator` is something a person in this
 * business chose to do and is attributable to them, `payment` is something the
 * provider told us happened. Conflating them makes an audit trail useless for
 * the question it exists to answer.
 *
 * `customer` exists because the command ledger holds both. A guest checkout is
 * a command — it takes an idempotency key and writes a `command_event` row —
 * but nobody in this business chose it, and reporting it as `operator` with the
 * buyer's own email as `actor` made every order in the book look like a staff
 * action. The namespace on `actor_sub` is what tells them apart, and a caller
 * cannot choose that prefix.
 */
type TimelineSource = "operator" | "customer" | "payment";

interface TimelineEntry {
  readonly at: number;
  readonly source: TimelineSource;
  /** The command name, or the provider's event type. */
  readonly action: string;
  /** Who did it. `null` for provider events — nobody here did them. */
  readonly actor: string | null;
  /** `applied` / `ignored` / `duplicate` for payments; `ok` / an error for commands. */
  readonly outcome: string;
  /** Whatever the recorder thought mattered, verbatim. */
  readonly detail: string | null;
}

/**
 * Read both logs for one order and interleave them.
 *
 * Returns `null` when the order does not exist, so the caller can answer
 * `not_found` rather than an empty history — which would be a lie about an
 * order that is merely young.
 */
export const orderTimeline = Effect.fn("Timeline.orderTimeline")(function* (
  db: ClassicDb,
  orderNumber: string,
) {
  const orders = yield* query(() =>
    db
      .select({ id: customerOrder.id })
      .from(customerOrder)
      .where(eq(customerOrder.orderNumber, orderNumber))
      .limit(1),
  );
  const order = orders[0];
  if (!order) return null;

  /**
   * Operator commands are recorded against the order NUMBER, which is what the
   * console and the domain `facts` both use as the target id.
   */
  const commands = yield* query(() =>
    db
      .select({
        at: commandEvent.createdAt,
        action: commandEvent.action,
        actor: commandEvent.actorEmail,
        actorSub: commandEvent.actorSub,
        outcome: commandEvent.outcome,
        detail: commandEvent.detailJson,
      })
      .from(commandEvent)
      .where(and(eq(commandEvent.targetType, "order"), eq(commandEvent.targetId, orderNumber)))
      .orderBy(asc(commandEvent.createdAt)),
  );

  // Provider events are recorded against the INTERNAL id — the handle the
  // session metadata carries, and the only one a webhook can supply.
  const payments = yield* query(() =>
    db
      .select({
        at: paymentEvent.createdAt,
        action: paymentEvent.eventType,
        outcome: paymentEvent.outcome,
      })
      .from(paymentEvent)
      .where(eq(paymentEvent.orderId, order.id))
      .orderBy(asc(paymentEvent.createdAt)),
  );

  const entries: TimelineEntry[] = [
    ...commands.map(
      (row): TimelineEntry => ({
        at: row.at,
        source: actorKind(row.actorSub),
        action: row.action,
        actor: row.actor,
        outcome: row.outcome,
        detail: row.detail,
      }),
    ),
    ...payments.map(
      (row): TimelineEntry => ({
        at: row.at,
        source: "payment",
        action: row.action,
        // Nobody in this business did this. Stripe told us it happened.
        actor: null,
        outcome: row.outcome,
        detail: null,
      }),
    ),
  ];

  /**
   * Sorted by timestamp, with `payment` breaking ties AFTER `operator`.
   *
   * Two entries can share a millisecond, and the tie-break is not arbitrary: a
   * webhook only ever describes something that already happened, so when a
   * command and an event land together the command came first.
   */
  return entries.sort(
    (a, b) => a.at - b.at || (a.source === b.source ? 0 : a.source === "operator" ? -1 : 1),
  );
});
