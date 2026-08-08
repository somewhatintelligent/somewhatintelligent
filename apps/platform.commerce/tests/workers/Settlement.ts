/**
 * TEST-ONLY Settlement. Declared by `tests/alchemy.run.ts` and nothing else.
 *
 * The same webhook, queue consumer, cron and three binding-only methods
 * `workers/Settlement.ts` deploys — both import `SettlementSurface.ts`. The only
 * difference is that this entry may fall back to the fake provider when the
 * machine has no Stripe.
 *
 * PAIRED WITH `tests/workers/Commerce.ts`, and that pairing is load-bearing: a
 * session minted by one provider cannot be settled by the other, so both resolve
 * through `resolveWithFake` and the test stack declares them together. A stack
 * that mixed a real Commerce with this would check out against Stripe and settle
 * against the fake — taking money and never marking an order paid.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import { StageTier } from "@swi/infra/stage/StandardizedStage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { settlementSurface } from "../../workers/SettlementSurface.ts";
import { environmentFor } from "@swi/infra/stripe";
import { resolveWithFake } from "../services/FakeProvider.ts";

export default class TestSettlementWorker extends Cloudflare.Worker<TestSettlementWorker>()(
  "Settlement",
  { main: import.meta.url },
  Effect.gen(function* () {
    const provider = yield* resolveWithFake(environmentFor(yield* StageTier));

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
