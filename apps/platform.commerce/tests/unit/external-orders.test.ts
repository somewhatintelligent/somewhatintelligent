/**
 * Orders paid elsewhere, recorded by hand — against real SQLite, through the
 * real ledger.
 *
 * The properties under test are the ones that make recording a sale by hand
 * safe to offer at all: that it takes units off the same shelf and the same
 * run a checkout does, that losing any guard leaves NOTHING behind, that a
 * double-submitted form records one order, and that the result is an ordinary
 * paid order — in the fulfilment queue, on the timeline as the operator's act,
 * invisible to the sweep that cancels abandoned checkouts.
 *
 * Driven through `Audit.claimed` rather than by calling the core alone,
 * because the claim riding in the reservation's own batch is half of the
 * idempotency story and a test that skipped it would be testing a different
 * protocol from the one the surface runs.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { OperatorCall, RecordExternalOrderInput } from "../../domain/Contracts.ts";
import * as ExternalOrders from "../../domain/ExternalOrders.ts";
import * as Orders from "../../domain/Orders.ts";
import * as Reconcile from "../../domain/Reconcile.ts";
import * as Timeline from "../../domain/Timeline.ts";
import {
  commandEvent,
  customerOrder,
  orderItem,
  product,
  productDraft,
  productRelease,
  productVariant,
} from "../../domain/Schema.ts";
import { Audit } from "../../services/Audit.ts";
import { Database, type DbStatement } from "../../services/Database.ts";
import { Ids } from "../../services/Ids.ts";
import { Payments } from "../../services/Payments.ts";
import { makeLocalDatabase, type LocalDatabase } from "./LocalD1.ts";

// ── Harness ──────────────────────────────────────────────────────────────────

const NOW = 1_767_225_600_000;
const OPERATOR = { sub: "operator:desk", email: "desk@example.com" };

let store: LocalDatabase;

beforeEach(() => {
  store = makeLocalDatabase();
});

afterEach(() => {
  store.close();
});

/** The capability stack the Commerce surface runs `recordExternalOrder` on, over SQLite. */
const services = () =>
  Layer.provideMerge(
    Audit.layer,
    Layer.mergeAll(
      Layer.succeed(
        Database,
        Database.of({
          db: store.db,
          run: (statements) => Effect.promise(() => store.run(statements)),
        }),
      ),
      Ids.layer,
    ),
  );

const call = (
  input: RecordExternalOrderInput,
  commandId = crypto.randomUUID(),
): OperatorCall<RecordExternalOrderInput> => ({
  input,
  meta: {
    actor: OPERATOR,
    requestId: crypto.randomUUID(),
    idempotencyKey: `${OPERATOR.sub}:recordExternalOrder:${commandId}`,
  },
});

/** Exactly what the surface does. */
const record = (operatorCall: OperatorCall<RecordExternalOrderInput>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const audit = yield* Audit;
      return yield* audit.claimed("recordExternalOrder", operatorCall, (claim) =>
        ExternalOrders.recordExternalOrder(operatorCall.input, claim),
      );
    }).pipe(Effect.provide(services())),
  );

interface SeedVariant {
  id: string;
  size: string;
  stock: number;
  mode?: "stock" | "preorder";
  expectedShipAt?: number | null;
}

const seedProduct = async (
  id: string,
  options: {
    title: string;
    releasedTitle?: string;
    status?: "draft" | "active" | "unavailable" | "archived";
    preorderCap?: number | null;
    variants: readonly SeedVariant[];
  },
) => {
  const releaseId = `${id}-release`;
  await store.run([
    store.db.insert(product).values({
      id,
      slug: id,
      status: options.status ?? "active",
      preorderCap: options.preorderCap ?? null,
      createdBySub: OPERATOR.sub,
      createdAt: NOW,
      updatedAt: NOW,
    }) as unknown as DbStatement,
    store.db.insert(productDraft).values({
      productId: id,
      title: options.title,
      updatedBySub: OPERATOR.sub,
      updatedAt: NOW,
    }) as unknown as DbStatement,
    ...(options.releasedTitle
      ? [
          store.db.insert(productRelease).values({
            id: releaseId,
            productId: id,
            version: "1.0.0",
            slug: id,
            title: options.releasedTitle,
            publishedBySub: OPERATOR.sub,
            publishedAt: NOW,
          }) as unknown as DbStatement,
          store.db
            .update(product)
            .set({ activeReleaseId: releaseId })
            .where(eq(product.id, id)) as unknown as DbStatement,
        ]
      : []),
    ...options.variants.map(
      (variant) =>
        store.db.insert(productVariant).values({
          id: variant.id,
          productId: id,
          size: variant.size,
          sku: `${id}-${variant.size}`,
          stock: variant.stock,
          mode: variant.mode ?? "stock",
          expectedShipAt: variant.expectedShipAt ?? null,
          createdAt: NOW,
        }) as unknown as DbStatement,
    ),
  ]);
};

const stockOf = async (variantId: string) =>
  (
    await store.db
      .select({ stock: productVariant.stock })
      .from(productVariant)
      .where(eq(productVariant.id, variantId))
  )[0]?.stock;

const claimedOf = async (productId: string) =>
  (
    await store.db
      .select({ claimed: product.preorderClaimed })
      .from(product)
      .where(eq(product.id, productId))
  )[0]?.claimed;

const countOrders = async () => (await store.db.select().from(customerOrder)).length;
const countItems = async () => (await store.db.select().from(orderItem)).length;

const ADDRESS = {
  name: "Ada Buyer",
  line1: "1 Main St",
  city: "Toronto",
  region: "ON",
  postal: "M5V 1A1",
  country: "CA" as const,
};

const baseInput = (items: RecordExternalOrderInput["items"]): RecordExternalOrderInput => ({
  market: "CA",
  email: "  Ada@Example.com ",
  shipping: ADDRESS,
  items,
  shippingCents: 1_500,
  taxCents: 1_170,
  payment: { method: "e-transfer", reference: " CA7Q2M " },
});

// ── Recording ────────────────────────────────────────────────────────────────

describe("recording an order paid elsewhere", () => {
  test("writes a complete, paid order and takes its units off the shelf", async () => {
    await seedProduct("tee", {
      title: "Field Tee (draft copy)",
      releasedTitle: "Field Tee",
      variants: [
        { id: "tee-m", size: "M", stock: 5 },
        { id: "tee-l", size: "L", stock: 1 },
      ],
    });

    const result = await record(
      call(
        baseInput([
          // A discount lives in the price actually charged, not in a gap.
          { variantId: "tee-m", quantity: 2, unitPriceCents: 4_000 },
          { variantId: "tee-l", quantity: 1, unitPriceCents: 4_500 },
        ]),
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      orderNumber: expect.stringMatching(/^SO-[0-9A-Z]{8}$/),
      totalCents: 12_500 + 1_500 + 1_170,
      currency: "cad",
    });

    const detail = await Effect.runPromise(Orders.getOrder(store.db, result.value.orderNumber));
    if ("failure" in detail) throw new Error("recorded order did not read back");
    expect(detail.response.value).toMatchObject({
      status: "paid",
      paymentStatus: "paid",
      externalPayment: { method: "e-transfer", reference: "CA7Q2M" },
      sessionId: null,
      // Filed under the buyer, normalised the way checkout files one.
      email: "ada@example.com",
      customerId: "customer:ada@example.com",
      subtotalCents: 12_500,
      shippingCents: 1_500,
      taxCents: 1_170,
      totalCents: 15_170,
      currency: "cad",
      shipping: ADDRESS,
    });
    // The title a shopper would have seen — the release's, not the draft's.
    expect(detail.response.value.items).toEqual([
      expect.objectContaining({
        title: "Field Tee",
        size: "M",
        quantity: 2,
        unitPriceCents: 4_000,
      }),
      expect.objectContaining({
        title: "Field Tee",
        size: "L",
        quantity: 1,
        unitPriceCents: 4_500,
      }),
    ]);

    expect(await stockOf("tee-m")).toBe(3);
    expect(await stockOf("tee-l")).toBe(0);

    // Held for good: the release marker is clear, so a later refund can release it.
    const [row] = await store.db
      .select({ released: customerOrder.stockReleasedAt })
      .from(customerOrder);
    expect(row?.released).toBeNull();
  });

  test("is ordinary paid work: in the fulfilment demand, and on the timeline as the operator's act", async () => {
    await seedProduct("tee", {
      title: "Field Tee",
      variants: [{ id: "tee-m", size: "M", stock: 5 }],
    });

    const result = await record(
      call(baseInput([{ variantId: "tee-m", quantity: 2, unitPriceCents: 4_500 }])),
    );
    if (!result.ok) throw new Error(result.error);

    const demand = await Effect.runPromise(Orders.fulfillmentDemand(store.db));
    expect(demand).toMatchObject({ orderCount: 1, unitCount: 2 });

    const timeline = await Effect.runPromise(
      Timeline.orderTimeline(store.db, result.value.orderNumber),
    );
    expect(timeline).toEqual([
      expect.objectContaining({
        source: "operator",
        action: "recordExternalOrder",
        actor: OPERATOR.email,
        outcome: "success",
      }),
    ]);
    expect(JSON.parse(timeline?.[0]?.detail ?? "{}")).toMatchObject({
      external: true,
      method: "e-transfer",
      reference: "CA7Q2M",
    });
  });

  test("sells a product that is not on the storefront, under its draft title", async () => {
    await seedProduct("sample", {
      title: "Sample Hoodie",
      status: "unavailable",
      variants: [{ id: "sample-m", size: "M", stock: 1 }],
    });

    const result = await record(
      call(baseInput([{ variantId: "sample-m", quantity: 1, unitPriceCents: 6_000 }])),
    );
    if (!result.ok) throw new Error(result.error);

    const [line] = await store.db.select().from(orderItem);
    expect(line?.titleSnapshot).toBe("Sample Hoodie");
    expect(await stockOf("sample-m")).toBe(0);
  });

  test("claims a place in the pre-order run, and snapshots the line as a pre-order", async () => {
    const expected = NOW + 30 * 24 * 60 * 60_000;
    await seedProduct("run", {
      title: "Run Jacket",
      preorderCap: 10,
      variants: [{ id: "run-m", size: "M", stock: 10, mode: "preorder", expectedShipAt: expected }],
    });

    const result = await record(
      call(baseInput([{ variantId: "run-m", quantity: 3, unitPriceCents: 12_000 }])),
    );
    if (!result.ok) throw new Error(result.error);

    expect(await claimedOf("run")).toBe(3);
    expect(await stockOf("run-m")).toBe(7);
    const [line] = await store.db.select().from(orderItem);
    expect(line).toMatchObject({ preorder: true, expectedShipAt: expected });
  });

  test("is left alone by the sweep that cancels abandoned checkouts", async () => {
    await seedProduct("tee", {
      title: "Field Tee",
      variants: [{ id: "tee-m", size: "M", stock: 5 }],
    });
    const result = await record(
      call(baseInput([{ variantId: "tee-m", quantity: 1, unitPriceCents: 4_500 }])),
    );
    if (!result.ok) throw new Error(result.error);

    // No session, and old enough to be an orphan twice over — were it pending.
    await store.run([
      store.db.update(customerOrder).set({ createdAt: 0 }) as unknown as DbStatement,
    ]);

    const unreachable = () => Effect.die("the sweep must not consult the provider here");
    const sweep = await Effect.runPromise(
      Reconcile.sweep().pipe(
        Effect.provide(
          Layer.mergeAll(
            services(),
            Layer.succeed(
              Payments,
              Payments.of({
                createSession: unreachable,
                retrieve: unreachable,
                expire: unreachable,
                parseEvent: unreachable,
              }),
            ),
          ),
        ),
      ),
    );

    expect(sweep.orphansReleased).toBe(0);
    const [row] = await store.db.select({ status: customerOrder.status }).from(customerOrder);
    expect(row?.status).toBe("paid");
    expect(await stockOf("tee-m")).toBe(4);
  });
});

// ── Idempotency ──────────────────────────────────────────────────────────────

describe("a double-submitted form records one order", () => {
  test("a retry with the same command id replays rather than selling twice", async () => {
    await seedProduct("tee", {
      title: "Field Tee",
      variants: [{ id: "tee-m", size: "M", stock: 5 }],
    });
    const input = baseInput([{ variantId: "tee-m", quantity: 2, unitPriceCents: 4_500 }]);

    const first = await record(call(input, "11111111-1111-4111-8111-111111111111"));
    const second = await record(call(input, "11111111-1111-4111-8111-111111111111"));

    expect(second).toEqual(first);
    expect(await countOrders()).toBe(1);
    expect(await stockOf("tee-m")).toBe(3);
  });

  test("losing the ledger claim inside the reservation's batch unwinds everything", async () => {
    await seedProduct("tee", {
      title: "Field Tee",
      variants: [{ id: "tee-m", size: "M", stock: 5 }],
    });
    const input = baseInput([{ variantId: "tee-m", quantity: 2, unitPriceCents: 4_500 }]);

    /**
     * Another request already holds this key. `Audit.claimed` would normally
     * see the row first; this is the race it cannot see — both requests past
     * the replay check, both at the batch — so the core is handed a claim that
     * is bound to lose to the unique index.
     */
    const key = `${OPERATOR.sub}:recordExternalOrder:racing`;
    const claimRow = (id: string) =>
      store.db
        .insert(commandEvent)
        .values({
          id,
          actorSub: OPERATOR.sub,
          actorEmail: OPERATOR.email,
          action: "recordExternalOrder",
          targetType: "pending",
          targetId: "pending",
          requestId: id,
          idempotencyKey: key,
          outcome: "pending",
          detailJson: null,
          responseJson: null,
          createdAt: NOW,
        })
        .onConflictDoNothing({
          target: [commandEvent.idempotencyKey, commandEvent.action],
        }) as unknown as DbStatement;
    await store.run([claimRow("winner")]);

    const outcome = await Effect.runPromise(
      ExternalOrders.recordExternalOrder(input, claimRow("loser")).pipe(Effect.provide(services())),
    );

    expect(outcome).toEqual({ failure: { ok: false, error: "in_progress" } });
    expect(await stockOf("tee-m")).toBe(5);
    expect(await countOrders()).toBe(0);
    expect(await countItems()).toBe(0);
  });
});

// ── Refusals ─────────────────────────────────────────────────────────────────

describe("a refusal leaves nothing behind", () => {
  test("a lost stock guard hands back the lines that won and deletes the order", async () => {
    await seedProduct("tee", {
      title: "Field Tee",
      variants: [
        { id: "tee-m", size: "M", stock: 5 },
        { id: "tee-l", size: "L", stock: 3 },
      ],
    });

    /**
     * Each L line fits the shelf on its own, so the early check passes both —
     * together they do not, and only the SQL guard knows. This is the shape of
     * a concurrent checkout taking the last units mid-flight.
     */
    const result = await record(
      call(
        baseInput([
          { variantId: "tee-m", quantity: 2, unitPriceCents: 4_500 },
          { variantId: "tee-l", quantity: 2, unitPriceCents: 4_500 },
          { variantId: "tee-l", quantity: 2, unitPriceCents: 4_500 },
        ]),
      ),
    );

    expect(result).toEqual({ ok: false, error: "out_of_stock", message: "Field Tee (L)" });
    expect(await stockOf("tee-m")).toBe(5);
    expect(await stockOf("tee-l")).toBe(3);
    expect(await countOrders()).toBe(0);
    expect(await countItems()).toBe(0);
  });

  test("a full pre-order run hands back the variant places it took", async () => {
    await seedProduct("run", {
      title: "Run Jacket",
      preorderCap: 4,
      variants: [
        { id: "run-m", size: "M", stock: 10, mode: "preorder" },
        { id: "run-l", size: "L", stock: 10, mode: "preorder" },
      ],
    });

    // Two sizes, one run: 3 + 2 overruns a cap of 4 that each fits alone.
    const result = await record(
      call(
        baseInput([
          { variantId: "run-m", quantity: 3, unitPriceCents: 12_000 },
          { variantId: "run-l", quantity: 2, unitPriceCents: 12_000 },
        ]),
      ),
    );

    expect(result).toEqual({ ok: false, error: "preorder_full", message: "Run Jacket" });
    expect(await claimedOf("run")).toBe(0);
    expect(await stockOf("run-m")).toBe(10);
    expect(await stockOf("run-l")).toBe(10);
    expect(await countOrders()).toBe(0);
  });

  test("a pre-order under a product with no run cap is refused as such, not as full", async () => {
    await seedProduct("run", {
      title: "Run Jacket",
      preorderCap: null,
      variants: [{ id: "run-m", size: "M", stock: 10, mode: "preorder" }],
    });

    const result = await record(
      call(baseInput([{ variantId: "run-m", quantity: 1, unitPriceCents: 12_000 }])),
    );

    expect(result).toEqual({ ok: false, error: "preorder_cap_missing", message: "Run Jacket" });
    expect(await countOrders()).toBe(0);
  });

  test("more than the shelf holds is refused before anything is written", async () => {
    await seedProduct("tee", {
      title: "Field Tee",
      variants: [{ id: "tee-m", size: "M", stock: 1 }],
    });

    const result = await record(
      call(baseInput([{ variantId: "tee-m", quantity: 2, unitPriceCents: 4_500 }])),
    );

    expect(result).toEqual({ ok: false, error: "out_of_stock", message: "Field Tee (M)" });
    expect(await stockOf("tee-m")).toBe(1);
    expect(await countOrders()).toBe(0);
  });

  test("hand-typed fields that would make a broken order are refused", async () => {
    await seedProduct("tee", {
      title: "Field Tee",
      variants: [{ id: "tee-m", size: "M", stock: 5 }],
    });
    const line = [{ variantId: "tee-m", quantity: 1, unitPriceCents: 4_500 }];

    expect(await record(call({ ...baseInput(line), email: "not an address" }))).toEqual({
      ok: false,
      error: "invalid_email",
    });
    expect(
      await record(call({ ...baseInput(line), shipping: { ...ADDRESS, line1: "   " } })),
    ).toEqual({ ok: false, error: "invalid_address" });
    expect(
      await record(call({ ...baseInput(line), payment: { method: "  ", reference: "x" } })),
    ).toEqual({ ok: false, error: "missing_payment_method" });
    expect(
      await record(call(baseInput([{ variantId: "nope", quantity: 1, unitPriceCents: 1 }]))),
    ).toEqual({ ok: false, error: "variant_not_found", message: "nope" });

    expect(await stockOf("tee-m")).toBe(5);
    expect(await countOrders()).toBe(0);
  });
});
