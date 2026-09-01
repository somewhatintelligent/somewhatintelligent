/**
 * The fulfilment read model against real SQLite.
 *
 * The property under test is the SQL boundary: every paid order is counted,
 * quantities for the same purchased variant are summed, similarly named
 * products stay separate, and statuses outside `paid` contribute nothing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";

import type { OrderStatus } from "../../domain/Contracts.ts";
import * as Orders from "../../domain/Orders.ts";
import { customerOrder, orderItem } from "../../domain/Schema.ts";
import { makeLocalDatabase, type LocalDatabase } from "./LocalD1.ts";

const NOW = 1_767_225_600_000;
const EXPECTED = NOW + 30 * 24 * 60 * 60_000;

interface SeedLine {
  productId: string;
  variantId: string;
  title: string;
  size: string;
  quantity: number;
  preorder?: boolean;
  expectedShipAt?: number | null;
}

let store: LocalDatabase;

beforeEach(() => {
  store = makeLocalDatabase();
});

afterEach(() => {
  store.close();
});

const seedOrder = async (id: string, status: OrderStatus, lines: readonly SeedLine[]) => {
  await store.run([
    store.db.insert(customerOrder).values({
      id,
      orderNumber: `SO-${id}`,
      userId: `buyer-${id}`,
      email: `${id}@example.com`,
      status,
      subtotalCents: 10_000,
      paymentStatus: status === "pending" ? "unpaid" : "paid",
      createdAt: NOW,
      updatedAt: NOW,
    }) as never,
    ...lines.map(
      (line, index) =>
        store.db.insert(orderItem).values({
          id: `${id}-line-${index}`,
          orderId: id,
          productId: line.productId,
          variantId: line.variantId,
          titleSnapshot: line.title,
          sizeSnapshot: line.size,
          unitPriceCents: 5_000,
          quantity: line.quantity,
          preorder: line.preorder ?? false,
          expectedShipAt: line.expectedShipAt ?? null,
        }) as never,
    ),
  ]);
};

describe("paid fulfilment demand", () => {
  test("aggregates the complete paid queue by purchased identity and mode", async () => {
    await seedOrder("paid-1", "paid", [
      {
        productId: "field",
        variantId: "field-m",
        title: "Field Tee",
        size: "M",
        quantity: 2,
      },
      {
        productId: "field",
        variantId: "field-l-pre",
        title: "Field Tee",
        size: "L",
        quantity: 1,
        preorder: true,
        expectedShipAt: EXPECTED,
      },
    ]);
    await seedOrder("paid-2", "paid", [
      {
        productId: "field",
        variantId: "field-m",
        title: "Field Tee",
        size: "M",
        quantity: 3,
      },
      {
        // Same human label, different product identity: never collapse these.
        productId: "field-collab",
        variantId: "field-collab-m",
        title: "Field Tee",
        size: "M",
        quantity: 4,
      },
      {
        productId: "hoodie",
        variantId: "hoodie-m-pre",
        title: "Logo Hoodie",
        size: "M",
        quantity: 2,
        preorder: true,
        expectedShipAt: EXPECTED,
      },
    ]);

    const excluded = ["pending", "shipped", "delivered", "cancelled"] as const;
    for (const [index, status] of excluded.entries()) {
      await seedOrder(`excluded-${index}`, status, [
        {
          productId: "field",
          variantId: "field-xl",
          title: "Field Tee",
          size: "XL",
          quantity: 100,
        },
      ]);
    }

    const demand = await Effect.runPromise(Orders.fulfillmentDemand(store.db));

    expect(demand).toEqual({
      orderCount: 2,
      unitCount: 12,
      lines: [
        {
          productId: "field",
          variantId: "field-m",
          title: "Field Tee",
          size: "M",
          quantity: 5,
          preorder: false,
          expectedShipAt: null,
        },
        {
          productId: "field-collab",
          variantId: "field-collab-m",
          title: "Field Tee",
          size: "M",
          quantity: 4,
          preorder: false,
          expectedShipAt: null,
        },
        {
          productId: "field",
          variantId: "field-l-pre",
          title: "Field Tee",
          size: "L",
          quantity: 1,
          preorder: true,
          expectedShipAt: EXPECTED,
        },
        {
          productId: "hoodie",
          variantId: "hoodie-m-pre",
          title: "Logo Hoodie",
          size: "M",
          quantity: 2,
          preorder: true,
          expectedShipAt: EXPECTED,
        },
      ],
    });
  });

  test("returns a zero summary for an empty queue", async () => {
    const demand = await Effect.runPromise(Orders.fulfillmentDemand(store.db));
    expect(demand).toEqual({ orderCount: 0, unitCount: 0, lines: [] });
  });
});
