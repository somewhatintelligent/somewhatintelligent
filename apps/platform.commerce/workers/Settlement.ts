/**
 * SETTLEMENT — async, provider-facing.
 *
 * Owns the payment provider relationship and nothing else. The webhook route,
 * the queue consumer and the cron are the DEPLOYED paths. The two RPC methods
 * exist so a test can assert an outcome instead of polling for one — and they
 * call the very same `settle` and `sweep` the queue and cron do, so a green test
 * is evidence about the real path rather than a parallel one.
 *
 * THE REAL ONE. Its provider is Stripe or nothing: `PaymentsProvider.resolve`
 * has no fallback to give, so a stage whose Stripe configuration does not
 * resolve fails the deploy rather than booting a settlement worker that cannot
 * verify a signature. Nothing in this file's import graph reaches
 * `PaymentsFake`; `tests/workers/Settlement.ts` is where that lives.
 *
 * The surface itself is in `SettlementSurface.ts`, shared by both entries.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as PaymentsProvider from "../services/PaymentsProvider.ts";
import { environmentFor } from "../services/StripeConfig.ts";
import { settlementSurface } from "./SettlementSurface.ts";

export default class SettlementWorker extends Cloudflare.Worker<SettlementWorker>()(
  "Settlement",
  /**
   * THE ONE WRITE PATH THIS PACKAGE DEPLOYS BEHIND A PUBLIC ADDRESS, and the
   * reasoning differs from Commerce's rather than contradicting it.
   *
   * Commerce keeps no address because it has no authentication of its own — the
   * binding IS its authorization. This worker's `fetch` has authentication built
   * in: an HMAC over the raw body, keyed by a secret only Stripe and this
   * deployment hold. Every other path 404s, and the RPC methods are still
   * reachable only over a binding.
   *
   * It needs an address because a provider cannot call a service binding. The
   * alternative — proxying raw bodies through another Worker — would move
   * nothing except the number of hops a signature has to survive intact.
   *
   * `workersDev` left at its default `true`, which is what alchemy
   * 2.0.0-beta.67 calls the `url: true` the spike wrote.
   */
  { main: import.meta.url },
  Effect.gen(function* () {
    const { stage } = yield* Stack;

    /**
     * THE SEAM, and nothing downstream knows which side it landed on —
     * `domain/Settlement.ts`, `domain/Reconcile.ts` and `domain/Checkout.ts` all
     * depend on `Payments` and never on a vendor.
     *
     * `livemode` falls out of the same resolution as a plain boolean, so the
     * environment gate in `settle` reads a constant rather than re-deriving the
     * account from a key on every event.
     */
    const provider = yield* PaymentsProvider.resolve(environmentFor(stage));

    return yield* settlementSurface(provider);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        Cloudflare.Queues.WriteQueueBinding,
        Cloudflare.Queues.EventSourceLive,
        Cloudflare.Workers.CronEventSourceLive,
      ),
    ),
  ),
) {}
