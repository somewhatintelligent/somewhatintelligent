/**
 * The settlement path: webhook → queue → settle, and the reconcile sweep.
 *
 * si's store carried 1,078 lines of provider tests and their case list is the
 * specification this file re-derives. Each test below corresponds to a way real
 * money or real inventory goes missing, which is why they earn an integration
 * test rather than a unit one — every property here is a claim about what is
 * COMMITTED, and only a real D1 can answer that.
 *
 * The suite shares `stage: "test_spike"` with the operator suite, so `deploy` is a
 * no-op diff when both run.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import { OperatorRpcs } from "../domain/Rpc.ts";
import { StorefrontRpcs } from "../domain/Storefront.rpc.ts";
import { awaitStackReady } from "./Ready.ts";
import Stack from "./alchemy.run.ts";

const { test, beforeAll, deploy } = Test.make({
  providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
  stage: "test_spike",
});

const HOOK_TIMEOUT = 600_000;
const TEST_TIMEOUT = 240_000;

/**
 * This suite DEPLOYS but never DESTROYS.
 *
 * It shares `stage: "test_spike"` with the operator suite, so its `deploy` is a
 * no-op diff when that suite has already run. Teardown is owned by exactly one
 * file — `store.integ.test.ts` — because two `afterAll(destroy)` hooks over one
 * stage means whichever finishes first pulls the infrastructure out from under
 * the other.
 */
/**
 * Deploy, THEN wait until the deployment is reachable. `deploy` resolving only
 * means Cloudflare accepted the resources — see `Ready.ts`.
 */
const stack = beforeAll(Effect.flatMap(deploy(Stack), awaitStackReady), {
  timeout: HOOK_TIMEOUT,
});

const makeOperatorClient = RpcClient.make(OperatorRpcs);
type OperatorClient = Effect.Success<typeof makeOperatorClient>;

const withClient = <A, E, R>(
  url: string,
  program: (client: OperatorClient) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const client = yield* makeOperatorClient;
    return yield* program(client);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      RpcClient.layerProtocolHttp({ url }).pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(RpcSerialization.layerNdjson),
      ),
    ),
  );

const makeShopperClient = RpcClient.make(StorefrontRpcs);
type ShopperClient = Effect.Success<typeof makeShopperClient>;

/** The customer contract, over the storefront's own address. */
const withShopper = <A, E, R>(
  catalogUrl: string,
  program: (client: ShopperClient) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    return yield* program(yield* makeShopperClient);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: `${catalogUrl}/rpc` }).pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(RpcSerialization.layerNdjson),
      ),
    ),
  );

const RUN = Math.random().toString(36).slice(2, 8);
let counter = 0;

/** Run-scoped so a re-run against a persistent stage is not an idempotent replay. */
const cmd = (label: string) => `${label}-${RUN}-${(counter += 1)}`;

/** Live stock for one variant, read through the operator surface. */
const variantStock = (edgeUrl: string, productId: string, variantId: string) =>
  withClient(edgeUrl, (client) =>
    Effect.map(
      client.getProduct({ productId }),
      (detail) => detail.variants.find((v) => v.id === variantId)?.stock ?? -1,
    ),
  );

const show = (title: string, body: unknown) => {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
  console.log(JSON.stringify(body, null, 2));
};

const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Drive settlement through the TYPED client — the same `replayEvent` an operator
 * console would call, running the same `settle` the queue consumer runs.
 */
interface Amounts {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
}

const settle = (
  edgeUrl: string,
  event: {
    id: string;
    type: string;
    sessionId?: string | null;
    orderId?: string | null;
    paymentStatus?: "unpaid" | "paid" | "no_payment_required" | null;
    livemode?: boolean;
    paymentIntentId?: string | null;
    refund?: {
      amountRefundedCents: number;
      chargeAmountCents: number;
      fullyRefunded: boolean;
    } | null;
    amounts?: Amounts | null;
    shipCountry?: string | null;
  },
  attempt = 1,
) =>
  withClient(edgeUrl, (client) =>
    client.replayEvent({
      event: {
        id: event.id,
        type: event.type,
        sessionId: event.sessionId ?? null,
        paymentStatus: event.paymentStatus ?? null,
        orderId: event.orderId ?? null,
        livemode: event.livemode ?? false,
        email: null,
        shipping: null,
        shipCountry: event.shipCountry ?? null,
        amounts: event.amounts ?? null,
        paymentIntentId: event.paymentIntentId ?? null,
        refund: event.refund ?? null,
      },
      attempt,
    }),
  );

const sweep = (edgeUrl: string) => withClient(edgeUrl, (client) => client.runSweep({}));

test(
  "S1 · an unmatched event retries, then is written off rather than retried forever",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;

    // No order carries this session — worth waiting on.
    const early = yield* settle(edgeUrl, {
      id: `evt-early-${RUN}`,
      type: "checkout.session.completed",
      sessionId: `sess-nobody-${RUN}`,
      paymentStatus: "paid",
    });
    show("S1 · first attempt", early);
    expect(early.outcome).toBe("retryable");

    // On the final attempt it becomes durable evidence and ACKS. This row is
    // what replaces a dead-letter queue.
    const exhausted = yield* settle(
      edgeUrl,
      {
        id: `evt-dead-${RUN}`,
        type: "checkout.session.completed",
        sessionId: `sess-nobody-${RUN}`,
        paymentStatus: "paid",
      },
      5,
    );
    show("S1 · final attempt", exhausted);
    expect(exhausted.outcome).toBe("dead");
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "S2 · an unmapped event type is ignored, and a replay is a duplicate",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;
    const eventId = `evt-unmapped-${RUN}`;

    const first = yield* settle(edgeUrl, {
      id: eventId,
      type: "customer.updated",
      sessionId: `sess-x-${RUN}`,
      paymentStatus: "paid",
    });
    const replay = yield* settle(edgeUrl, {
      id: eventId,
      type: "customer.updated",
      sessionId: `sess-x-${RUN}`,
      paymentStatus: "paid",
    });
    show("S2 · ignored then duplicate", { first, replay });

    // Unmapped is a VALUE, not a failure — it acks so the queue drains.
    expect(first.outcome).toBe("ignored");
    // The provider's event id is the replay key.
    expect(replay.outcome).toBe("duplicate");
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "S3 · a test-mode event never settles a live deployment",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;

    /**
     * The `test_spike` stage settles TEST-mode events, so a livemode event is the
     * misaimed one here. Either way the property is the same: an event from the
     * wrong environment is recorded and dropped, never applied.
     */
    const misaimed = yield* settle(edgeUrl, {
      id: `evt-wrongenv-${RUN}`,
      type: "checkout.session.completed",
      sessionId: `sess-wrongenv-${RUN}`,
      paymentStatus: "paid",
      livemode: true,
    });
    show("S3 · wrong environment", misaimed);
    expect(misaimed.outcome).toBe("ignored");
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "S5 · the sweep is idempotent and reports honestly on an empty database",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;

    yield* sweep(edgeUrl);
    const second = yield* sweep(edgeUrl);
    show("S5 · second sweep", second);

    // Nothing is healed or released twice — a sweep over settled state is a
    // no-op, which is what makes running it every fifteen minutes safe.
    expect(second.healed).toBe(0);
    expect(second.released).toBe(0);
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "S6 · the amounts charged are copied onto the order, and only from its own session",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl } = yield* stack;

    /**
     * A REAL ORDER placed against the deployed storefront, so the session id
     * under test is one checkout actually attached rather than a literal.
     */
    const slug = `settle-${RUN}-${(counter += 1)}`;
    const { variantId } = yield* withClient(edgeUrl, (client) =>
      Effect.gen(function* () {
        const created = yield* client.createProduct({
          commandId: cmd("create"),
          slug,
          title: `Settle ${slug}`,
        });
        yield* client.saveProductDraft({
          commandId: cmd("markets"),
          productId: created.productId,
          expectedRevision: 1,
          markets: [
            { market: "CA", priceCents: 4000, active: true },
            { market: "US", priceCents: 4000, active: true },
          ],
        });
        yield* client.ingestProductMedia({
          commandId: cmd("media"),
          productId: created.productId,
          bytesBase64: PIXEL_PNG,
          contentType: "image/png",
          alt: "cover",
          role: "cover",
        });
        const variant = yield* client.putVariant({
          commandId: cmd("variant"),
          productId: created.productId,
          size: "M",
          sku: `${slug}-M`,
          stock: 5,
        });
        yield* client.publishProduct({
          commandId: cmd("publish"),
          productId: created.productId,
          expectedRevision: 2,
          version: "1.0.0",
        });
        return { variantId: variant.variantId };
      }),
    );

    const placed = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("buy"),
        email: `settle-${RUN}@spike.local`,
        market: "CA",
        items: [{ variantId, quantity: 1 }],
      }),
    );
    // Before settlement the order knows its line items and nothing else: the
    // buyer has not picked a rate and no address exists to tax against.
    const before = yield* withClient(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );
    expect(before.subtotalCents).toBe(4000);
    expect(before.shippingCents).toBe(0);
    expect(before.taxCents).toBe(0);
    expect(before.totalCents).toBe(0);

    /**
     * A FOREIGN session naming this order — the shape of a dashboard re-fire or
     * a replayed fixture. It settles the status because the metadata does assert
     * the order was paid, but its money describes a session we never created.
     */
    yield* settle(edgeUrl, {
      id: `evt-foreign-${RUN}`,
      type: "checkout.session.completed",
      sessionId: `cs_test_someone_elses_${RUN}`,
      orderId: before.orderId,
      paymentStatus: "paid",
      amounts: {
        subtotalCents: 999_99,
        shippingCents: 999_99,
        taxCents: 999_99,
        totalCents: 2_999_97,
        currency: "usd",
      },
    });

    const afterForeign = yield* withClient(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );
    show("S6 · foreign session", {
      status: afterForeign.status,
      subtotalCents: afterForeign.subtotalCents,
      currency: afterForeign.currency,
    });
    expect(afterForeign.status).toBe("paid");
    // Untouched. This is the property: paid, but not restated in someone
    // else's currency at someone else's prices.
    expect(afterForeign.subtotalCents).toBe(4000);
    expect(afterForeign.totalCents).toBe(0);
    expect(afterForeign.currency).toBe("cad");
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "S7 · an event for the order's OWN session writes the charged amounts through",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl } = yield* stack;

    const slug = `own-${RUN}-${(counter += 1)}`;
    const { variantId } = yield* withClient(edgeUrl, (client) =>
      Effect.gen(function* () {
        const created = yield* client.createProduct({
          commandId: cmd("create"),
          slug,
          title: `Own ${slug}`,
        });
        yield* client.saveProductDraft({
          commandId: cmd("markets"),
          productId: created.productId,
          expectedRevision: 1,
          markets: [
            { market: "CA", priceCents: 3000, active: true },
            { market: "US", priceCents: 3000, active: true },
          ],
        });
        yield* client.ingestProductMedia({
          commandId: cmd("media"),
          productId: created.productId,
          bytesBase64: PIXEL_PNG,
          contentType: "image/png",
          alt: "cover",
          role: "cover",
        });
        const variant = yield* client.putVariant({
          commandId: cmd("variant"),
          productId: created.productId,
          size: "M",
          sku: `${slug}-M`,
          stock: 5,
        });
        yield* client.publishProduct({
          commandId: cmd("publish"),
          productId: created.productId,
          expectedRevision: 2,
          version: "1.0.0",
        });
        return { variantId: variant.variantId };
      }),
    );

    const placed = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("buy"),
        email: `own-${RUN}@spike.local`,
        market: "US",
        items: [{ variantId, quantity: 1 }],
      }),
    );

    /**
     * THE SAME session checkout attached. These are the figures the provider
     * charged — shipping the buyer selected, tax it assessed — and the order
     * must end up quoting exactly them rather than any arithmetic of its own.
     */
    yield* settle(edgeUrl, {
      id: `evt-own-${RUN}`,
      type: "checkout.session.completed",
      sessionId: placed.sessionId,
      paymentStatus: "paid",
      shipCountry: "US",
      amounts: {
        subtotalCents: 3000,
        shippingCents: 2200,
        taxCents: 390,
        totalCents: 5590,
        currency: "usd",
      },
    });

    const after = yield* withClient(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );
    show("S7 · own session", {
      subtotalCents: after.subtotalCents,
      shippingCents: after.shippingCents,
      taxCents: after.taxCents,
      totalCents: after.totalCents,
    });

    expect(after.status).toBe("paid");
    expect(after.shippingCents).toBe(2200);
    expect(after.taxCents).toBe(390);
    expect(after.totalCents).toBe(5590);
    expect(after.totalCents).toBe(after.subtotalCents + after.shippingCents + after.taxCents);
    expect(after.shipCountry).toBe("US");
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "S8 · a refund stops the order looking shippable and returns its stock",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl } = yield* stack;

    const slug = `refund-${RUN}-${(counter += 1)}`;
    const { productId, variantId } = yield* withClient(edgeUrl, (client) =>
      Effect.gen(function* () {
        const created = yield* client.createProduct({
          commandId: cmd("create"),
          slug,
          title: `Refund ${slug}`,
        });
        yield* client.saveProductDraft({
          commandId: cmd("markets"),
          productId: created.productId,
          expectedRevision: 1,
          markets: [
            { market: "CA", priceCents: 2000, active: true },
            { market: "US", priceCents: 2000, active: true },
          ],
        });
        yield* client.ingestProductMedia({
          commandId: cmd("media"),
          productId: created.productId,
          bytesBase64: PIXEL_PNG,
          contentType: "image/png",
          alt: "cover",
          role: "cover",
        });
        const variant = yield* client.putVariant({
          commandId: cmd("variant"),
          productId: created.productId,
          size: "M",
          sku: `${slug}-M`,
          stock: 4,
        });
        yield* client.publishProduct({
          commandId: cmd("publish"),
          productId: created.productId,
          expectedRevision: 2,
          version: "1.0.0",
        });
        return { productId: created.productId, variantId: variant.variantId };
      }),
    );

    const placed = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("buy"),
        email: `refund-${RUN}@spike.local`,
        market: "CA",
        items: [{ variantId, quantity: 1 }],
      }),
    );

    // Pay it, capturing the charge the refund will later name.
    const intent = `pi_test_${RUN}_${counter}`;
    yield* settle(edgeUrl, {
      id: `evt-paid-${RUN}`,
      type: "checkout.session.completed",
      sessionId: placed.sessionId,
      paymentStatus: "paid",
      paymentIntentId: intent,
      amounts: {
        subtotalCents: 2000,
        shippingCents: 1200,
        taxCents: 416,
        totalCents: 3616,
        currency: "cad",
      },
    });

    const stockAfterSale = yield* variantStock(edgeUrl, productId, variantId);
    expect(stockAfterSale).toBe(3);

    /**
     * THE REFUND. A charge event names no session and carries no metadata — it
     * finds this order only through the payment intent recorded above, which is
     * the entire reason that column exists.
     */
    const reversed = yield* settle(edgeUrl, {
      id: `evt-refund-${RUN}`,
      type: "charge.refunded",
      sessionId: null,
      paymentIntentId: intent,
      // FULL: the whole charge came back, so the order ends and stock returns.
      refund: { amountRefundedCents: 3616, chargeAmountCents: 3616, fullyRefunded: true },
    });
    show("S8 · refunded", reversed);
    expect(reversed.outcome).toBe("applied");

    const after = yield* withClient(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );
    // No longer shippable, and the reason is on the record.
    expect(after.status).toBe("cancelled");
    expect(after.paymentStatus).toBe("refunded");
    // Nothing shipped, so the unit is sellable again.
    expect(yield* variantStock(edgeUrl, productId, variantId)).toBe(4);
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "S9 · releasing an order twice restores its stock once",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl } = yield* stack;

    const slug = `release-${RUN}-${(counter += 1)}`;
    const { productId, variantId } = yield* withClient(edgeUrl, (client) =>
      Effect.gen(function* () {
        const created = yield* client.createProduct({
          commandId: cmd("create"),
          slug,
          title: `Release ${slug}`,
        });
        yield* client.saveProductDraft({
          commandId: cmd("markets"),
          productId: created.productId,
          expectedRevision: 1,
          markets: [
            { market: "CA", priceCents: 1500, active: true },
            { market: "US", priceCents: 1500, active: true },
          ],
        });
        yield* client.ingestProductMedia({
          commandId: cmd("media"),
          productId: created.productId,
          bytesBase64: PIXEL_PNG,
          contentType: "image/png",
          alt: "cover",
          role: "cover",
        });
        const variant = yield* client.putVariant({
          commandId: cmd("variant"),
          productId: created.productId,
          size: "M",
          sku: `${slug}-M`,
          stock: 5,
        });
        yield* client.publishProduct({
          commandId: cmd("publish"),
          productId: created.productId,
          expectedRevision: 2,
          version: "1.0.0",
        });
        return { productId: created.productId, variantId: variant.variantId };
      }),
    );

    const placed = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("buy"),
        email: `release-${RUN}@spike.local`,
        market: "CA",
        items: [{ variantId, quantity: 2 }],
      }),
    );
    expect(yield* variantStock(edgeUrl, productId, variantId)).toBe(3);

    /**
     * THE REAL SEQUENCE, not a contrived one. The reconcile sweep expires a
     * stale session and releases the order — and expiring the session is what
     * makes the provider emit `checkout.session.expired`. That event arrives
     * with a FRESH id, so the replay key does not catch it, and it lands on an
     * order that is already cancelled and already released.
     *
     * Before the release marker existed, this restored the same two units a
     * second time. It fires on every abandoned cart the sweep touches, with no
     * concurrency and no operator involvement — the store simply invents stock.
     */
    const first = yield* settle(edgeUrl, {
      id: `evt-expired-a-${RUN}`,
      type: "checkout.session.expired",
      sessionId: placed.sessionId,
      paymentStatus: "unpaid",
    });
    expect(first.outcome).toBe("applied");
    expect(yield* variantStock(edgeUrl, productId, variantId)).toBe(5);

    // A second, DIFFERENT expiry event for the same order — not a duplicate by
    // event id, so only the release marker can stop it.
    const second = yield* settle(edgeUrl, {
      id: `evt-expired-b-${RUN}`,
      type: "checkout.session.expired",
      sessionId: placed.sessionId,
      paymentStatus: "unpaid",
    });
    show("S9 · second expiry", second);

    // Ignored as late, and — the property that matters — stock is still 5.
    expect(second.outcome).toBe("ignored");
    expect(yield* variantStock(edgeUrl, productId, variantId)).toBe(5);
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "S10 · a PARTIAL refund records the money without killing the order",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl } = yield* stack;

    const slug = `partial-${RUN}-${(counter += 1)}`;
    const { productId, variantId } = yield* withClient(edgeUrl, (client) =>
      Effect.gen(function* () {
        const created = yield* client.createProduct({
          commandId: cmd("create"),
          slug,
          title: `Partial ${slug}`,
        });
        yield* client.saveProductDraft({
          commandId: cmd("markets"),
          productId: created.productId,
          expectedRevision: 1,
          markets: [
            { market: "CA", priceCents: 2500, active: true },
            { market: "US", priceCents: 2500, active: true },
          ],
        });
        yield* client.ingestProductMedia({
          commandId: cmd("media"),
          productId: created.productId,
          bytesBase64: PIXEL_PNG,
          contentType: "image/png",
          alt: "cover",
          role: "cover",
        });
        const variant = yield* client.putVariant({
          commandId: cmd("variant"),
          productId: created.productId,
          size: "M",
          sku: `${slug}-M`,
          stock: 4,
        });
        yield* client.publishProduct({
          commandId: cmd("publish"),
          productId: created.productId,
          expectedRevision: 2,
          version: "1.0.0",
        });
        return { productId: created.productId, variantId: variant.variantId };
      }),
    );

    const placed = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("buy"),
        email: `partial-${RUN}@spike.local`,
        market: "CA",
        items: [{ variantId, quantity: 2 }],
      }),
    );

    const intent = `pi_partial_${RUN}_${counter}`;
    yield* settle(edgeUrl, {
      id: `evt-paid-p-${RUN}`,
      type: "checkout.session.completed",
      sessionId: placed.sessionId,
      paymentStatus: "paid",
      paymentIntentId: intent,
      amounts: {
        subtotalCents: 5000,
        shippingCents: 1200,
        taxCents: 806,
        totalCents: 7006,
        currency: "cad",
      },
    });
    expect(yield* variantStock(edgeUrl, productId, variantId)).toBe(2);

    /**
     * A GOODWILL REFUND — 1000 of 7006. Stripe emits `charge.refunded` for this
     * exactly as it does for a full one; only the amounts differ. Read as total,
     * it would cancel an order the buyer is still owed and re-list two garments
     * they are keeping — and `cancelled` has no outgoing transition, so the
     * order could never be shipped afterwards.
     */
    const partial = yield* settle(edgeUrl, {
      id: `evt-partial-${RUN}`,
      type: "charge.refunded",
      sessionId: null,
      paymentIntentId: intent,
      refund: { amountRefundedCents: 1000, chargeAmountCents: 7006, fullyRefunded: false },
    });
    show("S10 · partial refund", partial);
    expect(partial.outcome).toBe("applied");

    const after = yield* withClient(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );
    // Still alive, still shippable, and the money is on the record.
    expect(after.status).toBe("paid");
    expect(after.paymentStatus).toBe("partially_refunded");
    expect(after.refundedCents).toBe(1000);
    expect(after.totalCents).toBe(7006);
    // The customer keeps the goods, so the goods do not come back.
    expect(yield* variantStock(edgeUrl, productId, variantId)).toBe(2);

    /**
     * A SECOND goodwill refund. `amount_refunded` is CUMULATIVE on the charge,
     * so the absolute write reports 1800 rather than compounding to 2600 — and
     * still nothing is restored.
     */
    yield* settle(edgeUrl, {
      id: `evt-partial-2-${RUN}`,
      type: "charge.refunded",
      sessionId: null,
      paymentIntentId: intent,
      refund: { amountRefundedCents: 1800, chargeAmountCents: 7006, fullyRefunded: false },
    });
    const twice = yield* withClient(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );
    expect(twice.refundedCents).toBe(1800);
    expect(twice.status).toBe("paid");
    expect(yield* variantStock(edgeUrl, productId, variantId)).toBe(2);
  }),
  { timeout: TEST_TIMEOUT },
);
