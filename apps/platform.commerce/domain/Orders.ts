/**
 * The operator's order lifecycle.
 *
 * One state machine covers order AND fulfillment — there is no separate
 * fulfillment state, which is why `status` runs
 * `pending → paid → shipped → delivered` with `cancelled` as a terminal
 * side-exit.
 *
 * THE OPERATOR CANNOT SET EVERY STATUS. `setOrderStatus` admits only `paid` and
 * `cancelled`; `shipped` is reachable only through {@link fulfillOrder} because
 * shipping without a carrier and tracking number produces an order a customer
 * cannot follow, and `delivered` only through {@link markDelivered} because it
 * has to follow a shipment.
 *
 * Orders are addressed by `orderNumber` throughout. The internal row id never
 * crosses the RPC boundary.
 */
import { and, asc, count, desc, eq, lt, or, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { CoreOutcome } from "../services/Audit.ts";
import { query, type ClassicDb, type DbStatement } from "../services/Database.ts";
import {
  err,
  ok,
  type FulfillOrderInput,
  type FulfillmentDemandDTO,
  type OrderDetailDTO,
  type OrderListInput,
  type OrderListResult,
  type OrderMutationError,
  type OrderStatus,
  type SetOrderStatusInput,
  type ShippingAddress,
} from "./Contracts.ts";
import { pageWindow, splitPage } from "../core/paging.ts";
import { customerOrder, orderItem } from "./Schema.ts";

/**
 * Which transitions are legal. Spelled as data rather than a chain of `if`s so
 * the whole machine is readable in one glance and testable without a database.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  TRANSITIONS[from].includes(to);

const toAddress = (row: {
  shipCountry: string;
  shipName: string | null;
  shipLine1: string | null;
  shipLine2: string | null;
  shipCity: string | null;
  shipRegion: string | null;
  shipPostal: string | null;
  shipPhone: string | null;
}): ShippingAddress | null =>
  // All-or-nothing, mirroring the `ship_address_atomic` CHECK: one non-null
  // core field means the whole group is present.
  row.shipName && row.shipLine1 && row.shipCity && row.shipRegion && row.shipPostal
    ? {
        name: row.shipName,
        line1: row.shipLine1,
        ...(row.shipLine2 ? { line2: row.shipLine2 } : {}),
        city: row.shipCity,
        region: row.shipRegion,
        postal: row.shipPostal,
        /**
         * READ, not asserted. The store sells to Canada and the US, checkout
         * pins the session to one of them, and settlement copies back the
         * country the buyer actually entered — so stamping "CA" here printed a
         * Canadian label on every Texan parcel.
         */
        country: row.shipCountry === "US" ? "US" : "CA",
        ...(row.shipPhone ? { phone: row.shipPhone } : {}),
      }
    : null;

/** Load one order plus its lines, by the operator-facing number. */
const loadOrder = Effect.fn("Orders.loadOrder")(function* (db: ClassicDb, orderNumber: string) {
  const rows = yield* query(() =>
    db.select().from(customerOrder).where(eq(customerOrder.orderNumber, orderNumber)).limit(1),
  );
  const row = rows[0];
  if (!row) return null;

  const items = yield* query(() =>
    db.select().from(orderItem).where(eq(orderItem.orderId, row.id)),
  );

  const detail: OrderDetailDTO = {
    orderId: row.id,
    orderNumber: row.orderNumber,
    sessionId: row.sessionId,
    customerId: row.userId,
    email: row.email,
    receiptEmail: row.receiptEmail,
    status: row.status as OrderStatus,
    paymentStatus: row.paymentStatus,
    subtotalCents: row.subtotalCents,
    shippingCents: row.shippingCents,
    taxCents: row.taxCents,
    totalCents: row.totalCents,
    currency: row.currency,
    refundedCents: row.refundedCents,
    shipCountry: row.shipCountry,
    shipping: toAddress(row),
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    fulfillmentNote: row.fulfillmentNote,
    shippedAt: row.shippedAt,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
    items: items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      title: item.titleSnapshot,
      size: item.sizeSnapshot,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      preorder: item.preorder,
      expectedShipAt: item.expectedShipAt,
    })),
  };
  return { row, detail };
});

export const listOrders = Effect.fn("Orders.listOrders")(function* (
  db: ClassicDb,
  input: OrderListInput,
): Effect.fn.Return<CoreOutcome<OrderListResult, "invalid_cursor">> {
  const window = pageWindow(input);
  if (!window.ok) return { failure: err("invalid_cursor") };
  const { limit, after } = window.value;

  const filters = [
    input.status && input.status !== "all" ? eq(customerOrder.status, input.status) : undefined,
    after
      ? or(
          lt(customerOrder.createdAt, after.at),
          and(eq(customerOrder.createdAt, after.at), lt(customerOrder.id, after.id)),
        )
      : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = yield* query(() =>
    db
      .select({
        id: customerOrder.id,
        orderNumber: customerOrder.orderNumber,
        email: customerOrder.email,
        shipName: customerOrder.shipName,
        totalCents: customerOrder.totalCents,
        status: customerOrder.status,
        paymentStatus: customerOrder.paymentStatus,
        createdAt: customerOrder.createdAt,
      })
      .from(customerOrder)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(customerOrder.createdAt), desc(customerOrder.id))
      .limit(limit + 1),
  );

  const { page, nextCursor } = splitPage(rows, limit, (row) => ({
    at: row.createdAt,
    id: row.id,
  }));

  return {
    statements: [],
    response: ok({
      orders: page.map(({ id: _id, ...rest }) => ({
        ...rest,
        status: rest.status as OrderStatus,
      })),
      nextCursor,
    }),
    facts: { targetType: "order", targetId: "list" },
  };
});

export const getOrder = Effect.fn("Orders.getOrder")(function* (
  db: ClassicDb,
  orderNumber: string,
): Effect.fn.Return<CoreOutcome<OrderDetailDTO, "not_found">> {
  const loaded = yield* loadOrder(db, orderNumber);
  if (!loaded) return { failure: err("not_found") };
  return {
    statements: [],
    response: ok(loaded.detail),
    facts: { targetType: "order", targetId: orderNumber },
  };
});

/**
 * Every unit represented by `paid`: money received, no shipment recorded.
 *
 * This is a DATABASE AGGREGATE rather than an aggregation over `listOrders`.
 * That list is paginated, and both console callers deliberately request bounded
 * windows; deriving operational demand from either would silently undercount as
 * soon as enough orders existed. Snapshot fields are grouped with identity so
 * catalog edits cannot rewrite the work while same-named products remain apart.
 *
 * `preorder` is kept as a dimension, not presentation trivia. In this model a
 * stock line is a physical unit already on the shelf while a pre-order line is
 * a unit in a manufacturing run. Combining them would tell a manufacturer to
 * make inventory the system says already exists.
 */
export const fulfillmentDemand = Effect.fn("Orders.fulfillmentDemand")(function* (
  db: ClassicDb,
): Effect.fn.Return<FulfillmentDemandDTO> {
  const orderTotals = yield* query(() =>
    db.select({ total: count() }).from(customerOrder).where(eq(customerOrder.status, "paid")),
  );

  const lines = yield* query(() =>
    db
      .select({
        productId: orderItem.productId,
        variantId: orderItem.variantId,
        title: orderItem.titleSnapshot,
        size: orderItem.sizeSnapshot,
        quantity: sql<number>`sum(${orderItem.quantity})`.mapWith(Number),
        preorder: orderItem.preorder,
        expectedShipAt: orderItem.expectedShipAt,
      })
      .from(orderItem)
      .innerJoin(customerOrder, eq(customerOrder.id, orderItem.orderId))
      .where(eq(customerOrder.status, "paid"))
      .groupBy(
        orderItem.productId,
        orderItem.variantId,
        orderItem.titleSnapshot,
        orderItem.sizeSnapshot,
        orderItem.preorder,
        orderItem.expectedShipAt,
      )
      .orderBy(
        asc(orderItem.preorder),
        asc(orderItem.titleSnapshot),
        asc(orderItem.expectedShipAt),
        asc(orderItem.sizeSnapshot),
        asc(orderItem.productId),
        asc(orderItem.variantId),
      ),
  );

  return {
    orderCount: orderTotals[0]?.total ?? 0,
    unitCount: lines.reduce((total, line) => total + line.quantity, 0),
    lines,
  };
});

/**
 * Set `paid` or `cancelled` by hand.
 *
 * Marking `paid` manually is a deliberate escape hatch for a payment that
 * settled out of band. It does NOT require `paymentStatus` to be paid, because
 * the whole point is to repair an order whose payment record is wrong.
 */
export const setOrderStatus = Effect.fn("Orders.setOrderStatus")(function* (
  db: ClassicDb,
  input: SetOrderStatusInput,
  now: number,
): Effect.fn.Return<CoreOutcome<OrderDetailDTO, OrderMutationError>> {
  const loaded = yield* loadOrder(db, input.orderNumber);
  if (!loaded) return { failure: err("not_found") };

  const from = loaded.detail.status;
  if (!canTransition(from, input.status)) {
    return { failure: err("invalid_transition", `${from} → ${input.status}`) };
  }

  return {
    statements: [
      db
        .update(customerOrder)
        .set({
          status: input.status,
          ...(input.status === "paid" ? { paymentStatus: "paid" } : {}),
          updatedAt: now,
        })
        .where(eq(customerOrder.id, loaded.row.id)) as unknown as DbStatement,
    ],
    response: ok({
      ...loaded.detail,
      status: input.status,
      ...(input.status === "paid" ? { paymentStatus: "paid" } : {}),
    }),
    facts: {
      targetType: "order",
      targetId: input.orderNumber,
      detail: { from, to: input.status },
    },
  };
});

/**
 * Ship an order.
 *
 * Guarded on `paid` rather than on `paymentStatus`, because `setOrderStatus`
 * can legitimately advance an out-of-band payment to `paid` without the payment
 * record agreeing. `already_fulfilled` is reported separately from
 * `invalid_transition` because it is the one an operator hits by
 * double-clicking, and it deserves a message that says so.
 */
export const fulfillOrder = Effect.fn("Orders.fulfillOrder")(function* (
  db: ClassicDb,
  input: FulfillOrderInput,
  now: number,
): Effect.fn.Return<CoreOutcome<OrderDetailDTO, OrderMutationError>> {
  const loaded = yield* loadOrder(db, input.orderNumber);
  if (!loaded) return { failure: err("not_found") };

  const from = loaded.detail.status;
  if (from === "shipped" || from === "delivered") return { failure: err("already_fulfilled") };
  if (!canTransition(from, "shipped")) {
    return { failure: err("invalid_transition", `${from} → shipped`) };
  }
  if (input.carrier.trim() === "" || input.trackingNumber.trim() === "") {
    return { failure: err("invalid_transition", "carrier and tracking number are required") };
  }

  const patch = {
    status: "shipped" as const,
    carrier: input.carrier,
    trackingNumber: input.trackingNumber,
    fulfillmentNote: input.note ?? null,
    shippedAt: now,
    updatedAt: now,
  };

  return {
    statements: [
      db
        .update(customerOrder)
        .set(patch)
        .where(eq(customerOrder.id, loaded.row.id)) as unknown as DbStatement,
    ],
    response: ok({
      ...loaded.detail,
      status: "shipped",
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      fulfillmentNote: input.note ?? null,
      shippedAt: now,
    }),
    facts: {
      targetType: "order",
      targetId: input.orderNumber,
      /**
       * The tracking number is recorded, not just the carrier. The audit row is
       * the answer to "what did we tell this customer, and when" — a carrier
       * without a number answers neither, and the order row only ever holds the
       * LATEST value, so a corrected number would erase the one that was sent.
       */
      detail: { carrier: input.carrier, trackingNumber: input.trackingNumber },
    },
  };
});

export const markDelivered = Effect.fn("Orders.markDelivered")(function* (
  db: ClassicDb,
  orderNumber: string,
  now: number,
): Effect.fn.Return<CoreOutcome<OrderDetailDTO, OrderMutationError>> {
  const loaded = yield* loadOrder(db, orderNumber);
  if (!loaded) return { failure: err("not_found") };

  const from = loaded.detail.status;
  if (!canTransition(from, "delivered")) {
    return { failure: err("invalid_transition", `${from} → delivered`) };
  }

  return {
    statements: [
      db
        .update(customerOrder)
        .set({ status: "delivered", deliveredAt: now, updatedAt: now })
        .where(eq(customerOrder.id, loaded.row.id)) as unknown as DbStatement,
    ],
    response: ok({ ...loaded.detail, status: "delivered" as const, deliveredAt: now }),
    facts: { targetType: "order", targetId: orderNumber, detail: { from } },
  };
});
