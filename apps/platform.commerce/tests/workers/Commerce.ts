/**
 * TEST-ONLY Commerce. Declared by `tests/alchemy.run.ts` and nothing else.
 *
 * Byte for byte the same 30-method surface `workers/Commerce.ts` deploys — both
 * import `CommerceSurface.ts`, so a green suite is evidence about the code that
 * ships. The ONLY difference is which payment provider goes in: this entry may
 * fall back to the D1-backed fake when the machine has no Stripe, and the
 * deployed entry cannot, because it cannot name it.
 *
 * That is the whole reason there are two files instead of one worker with a
 * flag. A flag leaves `PaymentsFake` in the deployed bundle whichever way it
 * lands, and left its `fake_session` table in the migration set applied to every
 * database including production's. A module boundary does not.
 *
 * Same `workersDev: false` as the real one: this is bound by `Edge` and
 * `Storefront` in the same stack and has no business holding an address, test
 * stack or not.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import { StageTier } from "@swi/infra/stage/StandardizedStage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { commerceSurface } from "../../workers/CommerceSurface.ts";
import { environmentFor } from "../../services/StripeConfig.ts";
import { resolveWithFake } from "../services/FakeProvider.ts";

export default class TestCommerceWorker extends Cloudflare.Worker<TestCommerceWorker>()(
  "Commerce",
  { main: import.meta.url, workersDev: false },
  Effect.gen(function* () {
    /**
     * Must agree with `tests/workers/Settlement.ts`. A session minted by one
     * provider cannot be settled by the other, so both test entries resolve
     * through the same function and the test stack declares them together.
     */
    const provider = yield* resolveWithFake(environmentFor(yield* StageTier));

    return yield* commerceSurface(provider);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(Cloudflare.D1.QueryDatabaseBinding, Cloudflare.R2.ReadWriteBucketBinding),
    ),
  ),
) {}
