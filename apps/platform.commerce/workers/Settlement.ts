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
import { Deployment, StageTier } from "@swi/infra/stage/StandardizedStage";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { serviceName, telemetry } from "@swi/infra/observability/telemetry";

import { Hostnames } from "../hostnames.ts";
import * as PaymentsProvider from "../services/PaymentsProvider.ts";
import { environmentFor } from "../services/StripeConfig.ts";
import { settlementSurface } from "./SettlementSurface.ts";

/**
 * The props, as an Effect — because the hostname has to read the stage and the
 * `alchemy dev` flag, and neither is available where a plain object is written.
 *
 * THE CAST IS A TYPE GAP, NOT A RUNTIME ONE, and it is worth being precise
 * about which. `Resource()` resolves props with
 * `Effect.isEffect(props) ? yield* props : props`, so an Effect here is
 * resolved before any provider sees it. What is narrow is only the class form's
 * THREE-argument overload, which declares plain `InputProps` — the two-argument
 * (implless) overload accepts an Effect, and this Worker needs an impl.
 *
 * DO NOT "FIX" THIS BY MOVING THE EFFECT ONTO THE `domain` FIELD. `Input<T>`
 * admits `Effect<T, any, any>` per field so it type-checks, and it is resolved
 * NOWHERE — `resolveWorkerDomain` reads `config.name` straight off the raw prop,
 * gets `undefined` off an Effect object, and the deploy dies in the middle with
 * `Could not infer Cloudflare Zone for hostname "undefined"` after half the
 * stack has already been created. Measured, on a prod deploy.
 */
const adoptName = "platformcommerce-settlement-prod-2xmvx22azgjhhcti" as const;
const settlementProps = Effect.gen(function* () {
  const { production, dev: local } = yield* Deployment;
  const { hooks } = yield* Hostnames;

  const env = serviceName("commerce-settlement");

  return local
    ? { main: import.meta.url, env }
    : {
        main: import.meta.url,
        domain: hooks,
        workersDev: false,
        env,
        ...(production ? { name: adoptName } : {}),
      };
}) as unknown as {
  main: string;
  domain?: string;
  workersDev?: boolean;
  name?: string;
  env: { OTEL_SERVICE_NAME: string };
};

export default class SettlementWorker extends Cloudflare.Worker<SettlementWorker>()(
  "Settlement",
  settlementProps,
  Effect.gen(function* () {
    /**
     * THE SEAM, and nothing downstream knows which side it landed on —
     * `domain/Settlement.ts`, `domain/Reconcile.ts` and `domain/Checkout.ts` all
     * depend on `Payments` and never on a vendor.
     *
     * `livemode` falls out of the same resolution as a plain boolean, so the
     * environment gate in `settle` reads a constant rather than re-deriving the
     * account from a key on every event.
     */
    const provider = yield* PaymentsProvider.resolve(environmentFor(yield* StageTier));

    return yield* settlementSurface(provider);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        Cloudflare.Queues.WriteQueueBinding,
        Cloudflare.Queues.EventSourceLive,
        Cloudflare.Workers.CronEventSourceLive,
        telemetry(),
      ),
    ),
  ),
) {}
