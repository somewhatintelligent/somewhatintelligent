/**
 * The operations that are not about one product or one order.
 *
 * `paymentsProvider` and `settlementProvider` are two different questions with
 * the same shape, and asking both is the point: Commerce MINTS payment sessions
 * and Settlement SETTLES them, and a deployment where those two resolved
 * different providers takes money and never marks an order paid. They come from
 * separate Workers, so this is the only place the agreement is observable.
 *
 * `runSweep` is the reconcile pass the cron fires every quarter hour. Running it
 * by hand is how a stuck order gets unstuck without waiting for the next tick —
 * it heals lost webhooks and releases stock reserved by carts that were
 * abandoned.
 */
import { createServerFn } from "@tanstack/react-start";

import { commerce, settlement } from "./commerce.server.ts";
import { requireOperator } from "./server-fn-actor.ts";

export const paymentsProvider = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .handler(async () => commerce().paymentsProvider());

/**
 * `livemode` is the one that matters before a launch: it says whether this
 * deployment is pointed at a Stripe account that moves real money.
 */
export const settlementProvider = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .handler(async () => settlement().provider());

export const runSweep = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async () => settlement().sweepNow());
