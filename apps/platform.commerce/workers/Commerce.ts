/**
 * COMMERCE — the operator backend. A pure backend: no routes, no SSR, no client
 * bundle, and no public URL.
 *
 * THE BINDING IS THE AUTHORIZATION BOUNDARY. This Worker performs no
 * authorization of its own: every method trusts `meta.actor` as already
 * validated by whoever bound it. So it must be bound to a trusted caller ONLY —
 * exposing it on a public route, or to an untrusted storefront, hands out
 * unauthenticated write access to the whole catalogue and order book.
 * `workersDev: false` is the first half of that; the wiring in `module.ts` is
 * the other half.
 *
 * THE REAL ONE. Its provider is Stripe or nothing: `PaymentsProvider.resolve`
 * has no fallback to give, so a stage whose Stripe configuration does not
 * resolve fails the deploy rather than booting onto something that cannot take
 * money. Nothing in this file's import graph reaches `PaymentsFake` — that is
 * the point of the split, and it is why `tests/workers/Commerce.ts` exists as a
 * separate entry rather than as a flag on this one.
 *
 * The surface itself is in `CommerceSurface.ts`, shared by both entries so the
 * test stack exercises the same 30 methods this deploys.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import { StageTier } from "@swi/infra/stage/StandardizedStage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { serviceName, telemetry } from "@swi/infra/observability/telemetry";

import * as PaymentsProvider from "../services/PaymentsProvider.ts";
import { commerceSurface } from "./CommerceSurface.ts";

export default class CommerceWorker extends Cloudflare.Worker<CommerceWorker>()(
  "Commerce",
  /**
   * `workersDev: false` — no stable `*.workers.dev` URL and no version preview
   * URL either. This is the `url: false` the spike wrote, under the name
   * alchemy 2.0.0-beta.67 gives it; the old prop no longer exists, so a
   * mechanical port would have failed to compile rather than silently
   * publishing the whole domain surface. Worth knowing which way that goes.
   */
  { main: import.meta.url, workersDev: false, env: serviceName("commerce") },
  Effect.gen(function* () {
    /**
     * Checkout mints payment sessions, so Commerce resolves the SAME provider
     * Settlement does, through the same function. They must agree: a session
     * created by one provider cannot be settled by the other, and a stage that
     * checked out against Stripe while settling against something else would
     * take money and never mark an order paid.
     */
    const provider = yield* PaymentsProvider.resolve(yield* StageTier);

    return yield* commerceSurface(provider);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        telemetry(),
      ),
    ),
  ),
) {}
