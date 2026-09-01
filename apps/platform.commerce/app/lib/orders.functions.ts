/**
 * The order book, over the binding.
 *
 * Pass-throughs, like the catalogue's, and for the same reason: the transitions
 * are the DOMAIN's. Fulfilling an unpaid order is refused with
 * `payment_incomplete` by Commerce, and the console's job is to render that
 * sentence rather than to pre-empt it with a disabled button that would drift
 * from the rule it is imitating.
 *
 * `setOrderStatus` takes only `paid` and `cancelled` — the two an operator may
 * set directly. `shipped` comes from `fulfillOrder` with a carrier and a
 * tracking number, and `delivered` from `markDelivered`, because both of those
 * record something beyond the status word.
 */
import { createServerFn } from "@tanstack/react-start";

import type { FulfillOrderInput, OrderListInput } from "../../domain/Contracts.ts";
import { commerce } from "./commerce.server.ts";
import { operatorCall, requireOperator } from "./server-fn-actor.ts";

const readMeta = (sub: string, action: string) => ({
  requestId: crypto.randomUUID(),
  idempotencyKey: `${sub}:${action}:read`,
});

export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .validator((data: OrderListInput) => data)
  .handler(async ({ context, data }) =>
    commerce().listOrders({
      input: data,
      meta: { actor: context.actor, ...readMeta(context.actor.sub, "listOrders") },
    }),
  );

export const getOrder = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .validator((data: { orderNumber: string }) => data)
  .handler(async ({ context, data }) =>
    commerce().getOrder({
      input: data,
      meta: { actor: context.actor, ...readMeta(context.actor.sub, "getOrder") },
    }),
  );

/** Complete paid, unshipped demand. Deliberately unpaginated and aggregated by Commerce. */
export const fulfillmentDemand = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .handler(async ({ context }) =>
    commerce().fulfillmentDemand({
      input: {},
      meta: { actor: context.actor, ...readMeta(context.actor.sub, "fulfillmentDemand") },
    }),
  );

/**
 * Both audit ledgers for one order, merged and ordered.
 *
 * Takes a bare order number rather than an envelope — it is a read that records
 * nothing, and the surface types it that way. `source` separates what a PERSON
 * did from what the provider REPORTED, which is the question the trail exists
 * to answer.
 */
export const orderTimeline = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .validator((data: { orderNumber: string }) => data)
  .handler(async ({ data }) => commerce().orderTimeline(data.orderNumber));

export const setOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator(
    (data: { orderNumber: string; status: "paid" | "cancelled"; commandId: string }) => data,
  )
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().setOrderStatus(
      operatorCall(context.actor, "setOrderStatus", commandId, input),
    );
  });

export const fulfillOrder = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: FulfillOrderInput & { commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().fulfillOrder(operatorCall(context.actor, "fulfillOrder", commandId, input));
  });

export const markDelivered = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: { orderNumber: string; commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().markDelivered(operatorCall(context.actor, "markDelivered", commandId, input));
  });
