/**
 * THE SETTLEMENT SURFACE — the webhook, the queue consumer, the cron and the
 * three binding-only methods. Everything except which payment provider is
 * behind them.
 *
 * Split out of `Settlement.ts` for the same reason `CommerceSurface.ts` was
 * split out of `Commerce.ts`, and it matters more here: this is the Worker that
 * verifies signatures and moves orders to `paid`. It is declared twice —
 *
 *   workers/Settlement.ts        the real one. Stripe or nothing.
 *   tests/workers/Settlement.ts  the test one, which may fall back to the fake.
 *
 * — so the deployed entry cannot name `PaymentsFake`, and therefore cannot ship
 * it or its table. Commerce and Settlement must land on the SAME provider or a
 * session minted by one cannot be settled by the other; the test stack declares
 * both test entries together, which is what keeps that true.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { workerSafeStage } from "platform.names";

import { sweep } from "../domain/Reconcile.ts";
import { MAX_ATTEMPTS, settle } from "../domain/Settlement.ts";
import { capabilities, handles } from "../runtime.ts";
import { Payments, type ProviderEvent } from "../services/Payments.ts";
import type { Provider } from "../services/PaymentsProvider.ts";

/** A queue name takes lowercase alphanumerics and hyphens — `dev_${USER}` is neither. */
export const EventsQueue = Cloudflare.Queues.Queue(
  "CommercePaymentEvents",
  Stack.useSync(({ stage }) => ({ name: `si-commerce-payments-${workerSafeStage(stage)}` })),
);

/** The maintenance trigger. Quarter-hourly is well inside the session TTL. */
const SWEEP_CRON = "*/15 * * * *";

/**
 * What travels on the queue: the compacted event, and nothing else.
 *
 * There is deliberately no `attempt` in the body. Cloudflare redelivers the
 * IDENTICAL body, so a counter carried inside it is frozen at whatever the
 * producer wrote — it can never increment, which made `attempt < MAX_ATTEMPTS`
 * permanently true and the `dead` evidence row unreachable on the deployed path.
 * The real counter is `message.attempts`, maintained by the queue itself.
 */
interface QueuedEvent {
  readonly event: ProviderEvent;
}

/**
 * Raised so the batch FAILS, which is the only way to make the queue redeliver.
 *
 * `settle` cannot fail — its error channel is `never` — so a `retryable` outcome
 * used to return successfully, the handler acked, and the event was gone with no
 * `payment_event` row to show it ever arrived. An event whose order has not been
 * written yet is exactly the case retrying exists for, so it has to become a
 * failure here.
 */
class SettlementNeedsRetry extends Schema.TaggedErrorClass<SettlementNeedsRetry>()(
  "SettlementNeedsRetry",
  { eventId: Schema.String, attempts: Schema.Number },
) {}

export const settlementSurface = Effect.fn("settlementSurface")(function* (provider: Provider) {
  const resolved = yield* handles;
  const livemode = provider.livemode;

  const layer = Layer.provideMerge(provider.layer, capabilities(resolved));

  const queue = yield* EventsQueue;
  const send = yield* Cloudflare.Queues.WriteQueue(queue);

  /**
   * `retryable` is the ONLY outcome that retries. applied / duplicate /
   * ignored / dead all ack, which is what stops a redelivery settling an
   * order twice and what makes the absence of a DLQ safe.
   *
   * MAKING THAT TRUE REQUIRES FAILING. The event source acks on success and
   * calls `msg.retry()` only on error, and `settle` cannot fail — so simply
   * running it and discarding the outcome acked everything, including the one
   * outcome that was supposed to come back.
   *
   * Failing the batch redelivers ALL of it, which is safe rather than merely
   * tolerable: anything already applied wrote a `payment_event` row keyed on
   * the provider's event id, so it returns as `duplicate` and touches nothing.
   */
  yield* Cloudflare.Queues.consumeQueueMessages<QueuedEvent>(
    queue,
    { maxRetries: MAX_ATTEMPTS },
    (messages) =>
      Effect.flatMap(Stream.runCollect(messages), (batch) =>
        Effect.forEach(
          batch,
          (message) =>
            settle(message.body.event, message.attempts, livemode).pipe(
              Effect.provide(layer),
              Effect.flatMap((settled) =>
                settled.outcome === "retryable"
                  ? Effect.fail(
                      new SettlementNeedsRetry({
                        eventId: message.body.event.id,
                        attempts: message.attempts,
                      }),
                    )
                  : Effect.void,
              ),
            ),
          { concurrency: 1, discard: true },
        ),
      ),
  );

  yield* Cloudflare.Workers.cron(SWEEP_CRON, () =>
    sweep().pipe(
      Effect.provide(layer),
      Effect.flatMap((result) => Effect.logInfo("store.reconcile.swept", result)),
      Effect.catchCause((cause) => Effect.logWarning("store.reconcile.failed", cause)),
    ),
  );

  return {
    /**
     * The webhook. Verify, compact, enqueue, answer 200 — the handler does no
     * database work, so a slow settle can never make the provider time out and
     * redeliver.
     *
     * Answering 200 at the enqueue point DOES opt out of the provider's own
     * multi-day retry, which is precisely why the reconcile sweep exists.
     */
    fetch: Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = new URL(request.url, "http://settlement").pathname;
      if (request.method !== "POST" || path !== "/webhook") {
        return yield* HttpServerResponse.json({ error: "not_found" }, { status: 404 });
      }

      const payments = yield* Payments;
      const body = yield* request.text;
      const signature = request.headers["stripe-signature"] ?? null;

      /**
       * An unverifiable body is a 400 and nothing else happens — no queue
       * write, no log of its contents. Handled by tag so the day `parseEvent`
       * grows a second failure mode, this stops compiling instead of quietly
       * answering 400 to something that deserved a different answer.
       */
      return yield* payments.parseEvent(body, signature).pipe(
        Effect.flatMap((event) =>
          Effect.andThen(send.send({ event }), HttpServerResponse.json({ received: true })),
        ),
        Effect.catchTag("EventNotVerified", () =>
          HttpServerResponse.json({ error: "invalid_signature" }, { status: 400 }),
        ),
      );
    }).pipe(
      Effect.provide(layer),
      Effect.catchCause((cause) =>
        Effect.flatMap(Effect.logError("store.request.failed", cause), () =>
          HttpServerResponse.json({ error: "internal" }, { status: 500 }),
        ),
      ),
    ),

    /** Settle synchronously — the same function the queue consumer runs. */
    settleNow: (event: ProviderEvent, attempt: number) =>
      settle(event, attempt, livemode).pipe(Effect.provide(layer)),

    /**
     * What this deployment settles for, and on what. The suite asserts both:
     * `kind` is how a run proves it exercised the real Stripe adapter rather
     * than quietly passing against the fake.
     */
    provider: () => Effect.succeed({ livemode, kind: provider.kind }),

    /** Run the sweep on demand, so a test need not wait a quarter hour. */
    sweepNow: () => sweep().pipe(Effect.provide(layer)),
  };
});
