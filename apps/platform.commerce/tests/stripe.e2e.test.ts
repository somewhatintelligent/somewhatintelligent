/**
 * THE REAL PAYMENT PATH, end to end, with nothing faked.
 *
 * Every other suite drives settlement through `replayEvent`, which hands a
 * hand-built event straight to `settle`. That proves the mapping is right. It
 * cannot prove the things that only exist between Stripe and this stack:
 *
 *   · a session Stripe actually minted, with OUR order id in its metadata;
 *   · a webhook Stripe actually signed, verified by `constructEventAsync`
 *     against the secret the CLI minted at deploy time;
 *   · the queue hop, the consumer, and the D1 commit that follows.
 *
 * So this suite uses `stripe trigger` — which creates real API objects in test
 * mode and lets Stripe deliver the resulting event — and `stripe listen`, which
 * relays that delivery to the deployed Settlement worker and SIGNS it. Nothing
 * below constructs an event.
 *
 * WHY THE LISTENER IS STARTED HERE rather than by `Command.Dev`. A `Dev` resource
 * runs under `alchemy dev` and is a no-op under `alchemy deploy` — correct, since
 * a deployed stage should get its webhooks from a registered endpoint. This suite
 * deploys, so it runs the same command itself; `StripeDev.listenCommand` is the
 * single definition both use.
 *
 * SKIPPED, NOT FAILED, when the machine has no Stripe. `stripe login` is the
 * entire setup — the CLI's own test key and signing secret are what the stack
 * deploys with.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Test from "alchemy/Test/Bun";
import { afterAll as bunAfterAll, expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import { OperatorRpcs } from "../domain/Rpc.ts";
import { CartRefused, StorefrontRpcs } from "../domain/Storefront.rpc.ts";
import { listenCommand } from "../infrastructure/StripeDev.ts";
import { awaitStackReady } from "./Ready.ts";
import { inspect, seed } from "./Seed.ts";
import Stack from "./alchemy.run.ts";

const { test, beforeAll, deploy } = Test.make({
  providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
  stage: "spike",
});

const HOOK_TIMEOUT = 600_000;
/** A trigger creates six API objects before the event fires; give it room. */
const TEST_TIMEOUT = 300_000;

/**
 * Does this machine have a usable Stripe?
 *
 * Resolved synchronously at module load because `test.skipIf` needs an answer
 * before any test registers. The same key the stack deploys with, read the same
 * way — so a skipped run and a green run cannot disagree about which provider
 * the deployment got.
 */
const stripeReady = (): boolean => {
  try {
    const probe = Bun.spawnSync(["stripe", "config", "--list"]);
    return probe.exitCode === 0 && /test_mode_api_key\s*=/.test(probe.stdout.toString());
  } catch {
    return false;
  }
};
const STRIPE_READY = stripeReady();

if (!STRIPE_READY) {
  console.log(
    "\n⚠  stripe.e2e: skipped — no Stripe CLI session on this machine.\n" +
      "   Run `stripe login` and re-run to exercise the real payment path.\n",
  );
}

/**
 * This suite DEPLOYS but never DESTROYS — teardown is owned by exactly one file
 * (`store.integ.test.ts`), because two `afterAll(destroy)` hooks over one stage
 * means whichever finishes first pulls the infrastructure out from under the
 * other.
 */
/**
 * Deploy, THEN wait until the deployment is reachable. `deploy` resolving only
 * means Cloudflare accepted the resources — see `Ready.ts`.
 */
const stack = beforeAll(Effect.flatMap(deploy(Stack), awaitStackReady), {
  timeout: HOOK_TIMEOUT,
});

/** The forwarder, owned by this file so it dies with it. */
let listener: Bun.Subprocess | null = null;

/**
 * Start the listener and wait until it says it is ready.
 *
 * Waiting matters: `stripe trigger` fires immediately, and an event delivered
 * before the websocket is up is simply lost — which would look exactly like a
 * settlement bug.
 */
const startListener = (webhookUrl: string) =>
  Effect.promise(async () => {
    // One forwarder for the file. Two would double-deliver every event, and a
    // duplicate is indistinguishable from a redelivery to the settlement path.
    if (listener) return;

    const child = Bun.spawn(["sh", "-c", listenCommand(webhookUrl)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    listener = child;

    const ready = new Promise<void>((resolve) => {
      const scan = async (stream: ReadableStream<Uint8Array>) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          const text = decoder.decode(value);
          process.stdout.write(`   [stripe listen] ${text}`);
          if (text.includes("Ready!")) resolve();
        }
      };
      void scan(child.stdout as ReadableStream<Uint8Array>);
      void scan(child.stderr as ReadableStream<Uint8Array>);
    });

    await Promise.race([ready, Bun.sleep(20_000)]);
    // A beat after "Ready!" — the socket is open before the first event routes.
    await Bun.sleep(1_000);
  });

bunAfterAll(() => {
  listener?.kill();
});

/**
 * Fire a real event carrying our order id.
 *
 * `--add checkout_session:metadata.storeOrderId=…` is what makes the triggered
 * session findable: Stripe mints its OWN session id, so `settle` cannot match on
 * one we created. It falls back to the order id in metadata — the same fallback
 * a re-fired event from the dashboard needs, which is why it exists in the
 * settlement path rather than as a test affordance.
 */
const trigger = (event: string, orderId: string | null) =>
  Effect.promise(async () => {
    const child = Bun.spawn(
      [
        "stripe",
        "trigger",
        event,
        // Omitted when the caller only wants the CHARGE the trigger produces and
        // does not want the resulting event to touch any of our orders.
        ...(orderId ? ["--add", `checkout_session:metadata.storeOrderId=${orderId}`] : []),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0) throw new Error(`stripe trigger ${event} exited ${code}: ${out}`);
    return out;
  });

/**
 * The charge behind the most recent triggered session.
 *
 * `stripe trigger checkout.session.completed` really does move test-mode money:
 * it creates a PaymentIntent, confirms it, and produces a Charge. That charge is
 * a genuine, refundable Stripe object — which is what lets the refund half of
 * this suite be real rather than replayed.
 */
const latestCharge = Effect.promise(async () => {
  const child = Bun.spawn(["stripe", "charges", "list", "--limit", "1"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  const charge = (JSON.parse(out) as { data: Array<{ id: string; payment_intent: string }> })
    .data[0];
  if (!charge) throw new Error("no charge on the account to refund");
  return charge;
});

/** Issue a REAL refund. Stripe emits `charge.refunded`, signed, to the listener. */
const refund = (chargeId: string) =>
  Effect.promise(async () => {
    const child = Bun.spawn(["stripe", "refunds", "create", "--charge", chargeId], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`stripe refunds create exited ${code}: ${err || out}`);
    return out;
  });

const makeOperatorClient = RpcClient.make(OperatorRpcs);
type OperatorClient = Effect.Success<typeof makeOperatorClient>;

const withOperator = <A, E, R>(
  url: string,
  program: (client: OperatorClient) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    return yield* program(yield* makeOperatorClient);
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

/** The CUSTOMER contract, over the storefront's own address. A shopper's view. */
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
const cmd = (label: string) => `${label}-${RUN}-${(counter += 1)}`;

const show = (title: string, body: unknown) => {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
  console.log(JSON.stringify(body, null, 2));
};

const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** A live product with known stock, so a release is measurable. */
const stockedProduct = (
  edgeUrl: string,
  stock: number,
  variant: {
    mode?: "stock" | "preorder";
    expectedShipAt?: number;
    /** Opens the product's manufacturing run. Required for any pre-order sale. */
    preorderCap?: number;
  } = {},
) =>
  withOperator(edgeUrl, (client) =>
    Effect.gen(function* () {
      const slug = `e2e-${RUN}-${(counter += 1)}`;
      const created = yield* client.createProduct({
        commandId: cmd("create"),
        slug,
        title: `E2E ${slug}`,
        priceCents: 2500,
      });
      yield* client.ingestProductMedia({
        commandId: cmd("media"),
        productId: created.productId,
        bytesBase64: PIXEL_PNG,
        contentType: "image/png",
        alt: "cover",
        role: "cover",
      });
      const made = yield* client.putVariant({
        commandId: cmd("variant"),
        productId: created.productId,
        size: "M",
        sku: `${slug}-M`,
        stock,
        ...(variant.mode ? { mode: variant.mode } : {}),
        ...(variant.expectedShipAt ? { expectedShipAt: variant.expectedShipAt } : {}),
      });
      /**
       * THE CAP BEFORE THE PUBLISH, and the order is now enforced rather than
       * incidental. Publishing sets `status = 'active'` itself, and a pre-order
       * variant with no run cap makes `runGuardStatement` match zero rows on
       * every claim — so that product would go live refusing every buyer with
       * `preorder_full`, permanently. `publishProduct` refuses it as
       * `preorder_cap_missing`.
       *
       * This helper used to publish first and set the cap after, which produced
       * a live-but-unbuyable product for the width of one round trip. It passed
       * because nothing bought anything in that window.
       */
      if (variant.preorderCap !== undefined) {
        yield* client.setPreorderCap({
          commandId: cmd("cap"),
          productId: created.productId,
          cap: variant.preorderCap,
        });
      }
      yield* client.publishProduct({
        commandId: cmd("publish"),
        productId: created.productId,
        expectedRevision: 1,
        version: "1.0.0",
      });
      return { productId: created.productId, variantId: made.variantId };
    }),
  );

/** The product's run: how many places are sold and how many are left. */
const runOf = (edgeUrl: string, productId: string) =>
  withOperator(edgeUrl, (client) =>
    Effect.map(client.getProduct({ productId }), (detail) => ({
      claimed: detail.preorder.claimed,
      remaining: detail.preorder.remaining,
    })),
  );

const stockOf = (edgeUrl: string, productId: string, variantId: string) =>
  withOperator(edgeUrl, (client) =>
    Effect.map(
      client.getProduct({ productId }),
      (detail) => detail.variants.find((variant) => variant.id === variantId)?.stock ?? -1,
    ),
  );

/**
 * Poll the order until it reaches the state the event should drive it to.
 *
 * The webhook answers 200 at the ENQUEUE point — that is the design, so a slow
 * settle cannot make the provider time out and redeliver. Which means the commit
 * lands strictly after the HTTP response, and a test that asserts immediately
 * would be asserting against a race the system deliberately has.
 */
const untilOrder = (
  edgeUrl: string,
  orderNumber: string,
  ready: (order: { status: string; paymentStatus: string }) => boolean,
) =>
  withOperator(edgeUrl, (client) => client.getOrder({ orderNumber })).pipe(
    Effect.flatMap((order) =>
      ready(order) ? Effect.succeed(order) : Effect.fail("not yet" as const),
    ),
    Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 45 }),
  );

test.skipIf(!STRIPE_READY)(
  "E1 · a real Stripe session, signed by Stripe, settles the order it names",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl, settlementUrl } = yield* stack;
    yield* startListener(`${settlementUrl}/webhook`);

    const { productId, variantId } = yield* stockedProduct(edgeUrl, 5);

    /**
     * Placed through the CUSTOMER contract on the storefront's own address —
     * the same path a browser takes. Not the operator surface.
     */
    const placed = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("buy"),
        email: `e2e-${RUN}@spike.local`,
        destination: "CA",
        items: [{ variantId, quantity: 1 }],
      }),
    );
    show("E1 · placed", placed);

    /**
     * A hosted checkout URL is the proof the adapter reached Stripe. The fake
     * returns `null` here, so this assertion is what stops the suite passing
     * green against a provider that never talks to anyone.
     */
    expect(placed.sessionId).toStartWith("cs_test_");
    expect(placed.checkoutUrl).toContain("stripe.com");

    // Stock moved at reservation time, before any payment.
    expect(yield* stockOf(edgeUrl, productId, variantId)).toBe(4);

    const order = yield* withOperator(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );
    expect(order.sessionId).toBe(placed.sessionId);

    yield* trigger("checkout.session.completed", order.orderId);

    const settled = yield* untilOrder(edgeUrl, placed.orderNumber, (o) => o.status === "paid");
    show("E1 · settled", settled);

    expect(settled.status).toBe("paid");
    expect(settled.paymentStatus).toBe("paid");

    /**
     * A FOREIGN SESSION SETTLES THE STATUS BUT WRITES NOTHING ELSE.
     *
     * `stripe trigger` mints its own session — different id, its own currency,
     * its own fixture address — and reaches this order only through the order id
     * in metadata. That is exactly the shape of a dashboard re-fire, and it is
     * why collected facts are gated on session identity: copying that session's
     * address here would ship this parcel to a Stripe test fixture, and copying
     * its amounts would restate the order in a currency nobody was charged.
     *
     * So the order is paid, and its money and address are untouched.
     */
    expect(settled.sessionId).toBe(placed.sessionId);
    expect(settled.currency).toBe("cad");
    expect(settled.subtotalCents).toBe(2500);
    expect(settled.shipping).toBeNull();

    // Paid stock stays consumed — settling must not double-release.
    expect(yield* stockOf(edgeUrl, productId, variantId)).toBe(4);
  }),
  { timeout: TEST_TIMEOUT },
);

test.skipIf(!STRIPE_READY)(
  "E2 · an expired session cancels the order AND returns its stock",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl, settlementUrl } = yield* stack;
    yield* startListener(`${settlementUrl}/webhook`);

    const { productId, variantId } = yield* stockedProduct(edgeUrl, 3);

    const placed = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("buy"),
        email: `e2e-${RUN}@spike.local`,
        destination: "US",
        items: [{ variantId, quantity: 2 }],
      }),
    );
    expect(yield* stockOf(edgeUrl, productId, variantId)).toBe(1);

    const order = yield* withOperator(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );

    yield* trigger("checkout.session.expired", order.orderId);

    const cancelled = yield* untilOrder(
      edgeUrl,
      placed.orderNumber,
      (o) => o.status === "cancelled",
    );
    show("E2 · cancelled", cancelled);
    expect(cancelled.paymentStatus).toBe("expired");

    /**
     * THE ASSERTION THIS SUITE EXISTS FOR. Cancelling without restoring stock
     * strands units nobody bought — permanently, because no later event refers to
     * this order again. It is invisible to every test that only checks order
     * status, and it is the bug this port shipped with until the settlement path
     * was read against si's case list.
     */
    expect(yield* stockOf(edgeUrl, productId, variantId)).toBe(3);
  }),
  { timeout: TEST_TIMEOUT },
);

test.skipIf(!STRIPE_READY)(
  "E3 · the webhook refuses a body Stripe did not sign",
  Effect.gen(function* () {
    const { settlementUrl } = yield* stack;

    /**
     * A well-formed event with no signature. The FAKE provider would accept this
     * — it has no secret to verify against — so a 400 here is direct evidence
     * that the deployed worker is running the real adapter and really is
     * verifying. Forging one requires the endpoint secret, which is the entire
     * security model of an unauthenticated public webhook route.
     */
    const response = yield* Effect.promise(() =>
      fetch(`${settlementUrl}/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: `evt_forged_${RUN}`,
          type: "checkout.session.completed",
          data: { object: { id: `cs_test_forged_${RUN}`, payment_status: "paid" } },
        }),
      }),
    );
    show("E3 · unsigned webhook", { status: response.status });
    expect(response.status).toBe(400);
  }),
  { timeout: TEST_TIMEOUT },
);

test.skipIf(!STRIPE_READY)(
  "E4 · a pre-order run sells to its cap, then refuses — and the buyer is told",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl } = yield* stack;

    /**
     * NO INVENTORY EXISTS. `stock` here is the size of a manufacturing run that
     * has not happened, which is the mode this store opens in: take orders, then
     * make the garments. The cap is the whole safety property — selling 3 places
     * in a run of 2 means owing someone a shirt that was never made.
     */
    const shipsAt = Date.parse("2026-11-01T00:00:00Z");
    /**
     * `stock` is generous; the RUN is what binds. That is the real shape: you
     * decide to make 2 garments, not 2 mediums — per-variant counts exist only
     * to stop one size eating the whole run.
     */
    const { productId, variantId } = yield* stockedProduct(edgeUrl, 50, {
      mode: "preorder",
      expectedShipAt: shipsAt,
      preorderCap: 2,
    });

    const first = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("pre"),
        email: `e2e-${RUN}@spike.local`,
        destination: "CA",
        items: [{ variantId, quantity: 2 }],
      }),
    );
    show("E4 · run subscribed", first);
    expect(first.sessionId).toStartWith("cs_test_");
    // The run is spoken for; the variant still has plenty of nominal headroom.
    expect(yield* runOf(edgeUrl, productId)).toEqual({ claimed: 2, remaining: 0 });
    expect(yield* stockOf(edgeUrl, productId, variantId)).toBe(48);

    /**
     * The run is full. The refusal is `preorder_full` rather than `out_of_stock`
     * because a shopper reading "out of stock" on a pre-order page has been told
     * something false — there was never stock, and there will not be more of
     * this run.
     */
    const overflow = yield* Effect.result(
      withShopper(catalogUrl, (client) =>
        client.placeOrder({
          commandId: cmd("pre"),
          email: `e2e-${RUN}@spike.local`,
          destination: "CA",
          items: [{ variantId, quantity: 1 }],
        }),
      ),
    );
    show("E4 · run full", overflow);
    expect(overflow._tag).toBe("Failure");
    if (overflow._tag === "Failure") {
      expect(overflow.failure._tag).toBe("CartRefused");
      expect((overflow.failure as CartRefused).reason).toBe("preorder_full");
    }

    /**
     * The ship date is SNAPSHOT on the line, so flipping the variant to `stock`
     * the day the run lands cannot rewrite what this buyer was promised.
     */
    const order = yield* withOperator(edgeUrl, (client) =>
      client.getOrder({ orderNumber: first.orderNumber }),
    );
    expect(order.items[0]?.preorder).toBe(true);
    expect(order.items[0]?.expectedShipAt).toBe(shipsAt);
  }),
  { timeout: TEST_TIMEOUT },
);

test.skipIf(!STRIPE_READY)(
  "E5 · an operator can record tracking, and the customer can read it back",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl, settlementUrl } = yield* stack;
    yield* startListener(`${settlementUrl}/webhook`);

    const email = `e2e-${RUN}-track@spike.local`;
    const { variantId } = yield* stockedProduct(edgeUrl, 3);

    const placed = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("track"),
        email,
        destination: "US",
        items: [{ variantId, quantity: 1 }],
      }),
    );

    const order = yield* withOperator(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );
    yield* trigger("checkout.session.completed", order.orderId);
    yield* untilOrder(edgeUrl, placed.orderNumber, (o) => o.status === "paid");

    /**
     * Shipping is only reachable through `fulfillOrder`, never through a status
     * set — an order marked shipped with no carrier and no number is one the
     * customer cannot follow, so the two are recorded in the same call that
     * moves the state.
     */
    const shipped = yield* withOperator(edgeUrl, (client) =>
      client.fulfillOrder({
        commandId: cmd("ship"),
        orderNumber: placed.orderNumber,
        carrier: "Canada Post",
        trackingNumber: `TRK-${RUN}`,
      }),
    );
    show("E5 · fulfilled", { status: shipped.status, carrier: shipped.carrier });
    expect(shipped.status).toBe("shipped");
    expect(shipped.shippedAt).toBeGreaterThan(0);

    // The buyer reads it back through the CUSTOMER contract, proving the
    // tracking number survives the projection rather than staying operator-only.
    const mine = yield* withShopper(catalogUrl, (client) =>
      client.getMyOrder({ orderNumber: placed.orderNumber, email }),
    );
    show("E5 · customer view", mine);
    expect(mine.carrier).toBe("Canada Post");
    expect(mine.trackingNumber).toBe(`TRK-${RUN}`);
    expect(mine.shippedAt).toBeGreaterThan(0);
    // Their own line items, not the operator's view of them.
    expect(mine.items).toHaveLength(1);
    expect(mine.subtotalCents).toBe(2500);

    /**
     * THE TIMELINE. The order row holds only the latest value of every field, so
     * "when did the money arrive" and "when did we set the tracking number, and
     * what was it" are not answerable from it. They are answerable here, merged
     * from the two append-only logs the store already keeps.
     */
    const history = yield* withOperator(edgeUrl, (client) =>
      client.orderTimeline({ orderNumber: placed.orderNumber }),
    );
    show(
      "E5 · timeline",
      history.map((e) => ({ source: e.source, action: e.action, outcome: e.outcome })),
    );

    const actions = history.map((entry) => entry.action);
    expect(actions).toContain("placeOrder");
    expect(actions).toContain("checkout.session.completed");
    expect(actions).toContain("fulfillOrder");

    // Provider events are never attributed to a person; commands always are.
    const payment = history.find((e) => e.action === "checkout.session.completed");
    expect(payment?.source).toBe("payment");
    expect(payment?.actor).toBeNull();

    /**
     * The tracking number is IN THE LOG, not just on the row. A corrected number
     * would overwrite the order's field but never this entry — which is what
     * makes "what did we actually tell this customer" answerable later.
     */
    const fulfil = history.find((e) => e.action === "fulfillOrder");
    expect(fulfil?.source).toBe("operator");
    expect(fulfil?.detail).toContain(`TRK-${RUN}`);
    expect(fulfil?.detail).toContain("Canada Post");

    // Chronological, so it reads as a story rather than a table dump.
    const times = history.map((entry) => entry.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  }),
  { timeout: TEST_TIMEOUT },
);

test.skipIf(!STRIPE_READY)(
  "E6 · a real charge is paid then REFUNDED through Stripe, and the stock comes back",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl, settlementUrl } = yield* stack;
    yield* startListener(`${settlementUrl}/webhook`);

    const { productId, variantId } = yield* stockedProduct(edgeUrl, 6);

    const placed = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("refundme"),
        email: `e2e-${RUN}-refund@spike.local`,
        destination: "CA",
        items: [{ variantId, quantity: 2 }],
      }),
    );
    expect(yield* stockOf(edgeUrl, productId, variantId)).toBe(4);

    /**
     * A REAL CHARGE, minted WITHOUT naming our order.
     *
     * The trigger confirms a test-mode payment, so what comes back is a Stripe
     * Charge with a live PaymentIntent behind it — refundable through the API
     * exactly like a customer's. No metadata is attached, so the resulting
     * `checkout.session.completed` describes only Stripe's own fixture session
     * and leaves this order alone.
     */
    yield* trigger("checkout.session.completed", null);
    const charge = yield* latestCharge;
    show("E6 · charge", { id: charge.id, intent: charge.payment_intent });

    /**
     * Settle the order from ITS OWN session, carrying that real payment intent —
     * which is precisely what a live webhook endpoint delivers, and the only way
     * the order can record the intent a refund will later name. A charge event
     * carries no session and no metadata, so that column is the sole join.
     */
    yield* withOperator(edgeUrl, (client) =>
      client.replayEvent({
        event: {
          id: `evt-link-${RUN}`,
          type: "checkout.session.completed",
          sessionId: placed.sessionId,
          orderId: null,
          paymentStatus: "paid",
          livemode: false,
          email: null,
          shipping: null,
          shipCountry: "CA",
          amounts: {
            subtotalCents: 5000,
            shippingCents: 1200,
            taxCents: 806,
            totalCents: 7006,
            currency: "cad",
          },
          paymentIntentId: charge.payment_intent,
          refund: null,
        },
        attempt: 1,
      }),
    );

    const linked = yield* withOperator(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );
    expect(linked.status).toBe("paid");
    expect(linked.totalCents).toBe(7006);
    expect(linked.taxCents).toBe(806);

    /**
     * THE REFUND IS REAL. Stripe issues it, signs the resulting
     * `charge.refunded`, and the CLI forwards it to the deployed worker — the
     * same path a dashboard refund takes in production. Nothing below is
     * constructed by this test.
     */
    yield* refund(charge.id);

    const reversed = yield* untilOrder(
      edgeUrl,
      placed.orderNumber,
      (o) => o.paymentStatus === "refunded",
    );
    show("E6 · refunded", { status: reversed.status, paymentStatus: reversed.paymentStatus });

    // No longer shippable, and the reason is on the record rather than inferred.
    expect(reversed.status).toBe("cancelled");
    expect(reversed.paymentStatus).toBe("refunded");

    /**
     * AND THE STOCK IS BACK. Nothing shipped, so the two units are sellable
     * again — this is the half a refund handler usually forgets, and the units
     * it strands are gone permanently because no later event mentions the order.
     */
    expect(yield* stockOf(edgeUrl, productId, variantId)).toBe(6);
  }),
  { timeout: TEST_TIMEOUT },
);

test.skipIf(!STRIPE_READY)(
  "E7 · the pre-order cap is an AGGREGATE — sizes draw from one run",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl } = yield* stack;

    /**
     * THE PROPERTY THIS SUITE EXISTS FOR. A run of 3 means three garments get
     * made, however the sizes fall. If the cap were per-variant, this product
     * would sell 3 mediums AND 3 larges — six shirts against a run of three,
     * which is not a cap at all, and the two extra are owed to people who paid.
     */
    const slug = `agg-${RUN}-${(counter += 1)}`;
    const { productId, medium, large } = yield* withOperator(edgeUrl, (client) =>
      Effect.gen(function* () {
        const created = yield* client.createProduct({
          commandId: cmd("create"),
          slug,
          title: `Aggregate ${slug}`,
          priceCents: 3500,
        });
        yield* client.ingestProductMedia({
          commandId: cmd("media"),
          productId: created.productId,
          bytesBase64: PIXEL_PNG,
          contentType: "image/png",
          alt: "cover",
          role: "cover",
        });
        // Each size has generous headroom of its own — only the run binds.
        const m = yield* client.putVariant({
          commandId: cmd("m"),
          productId: created.productId,
          size: "M",
          sku: `${slug}-M`,
          stock: 50,
          mode: "preorder",
        });
        const l = yield* client.putVariant({
          commandId: cmd("l"),
          productId: created.productId,
          size: "L",
          sku: `${slug}-L`,
          stock: 50,
          mode: "preorder",
        });
        // The cap before the publish — `publishProduct` refuses a pre-order
        // product with no run to claim against. See the note in `liveProduct`.
        const run = yield* client.setPreorderCap({
          commandId: cmd("cap"),
          productId: created.productId,
          cap: 3,
        });
        expect(run.remaining).toBe(3);
        yield* client.publishProduct({
          commandId: cmd("publish"),
          productId: created.productId,
          expectedRevision: 1,
          version: "1.0.0",
        });
        return { productId: created.productId, medium: m.variantId, large: l.variantId };
      }),
    );

    // Two mediums: the run is down to one, and LARGE is affected too.
    yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("m2"),
        email: `agg-${RUN}@spike.local`,
        destination: "CA",
        items: [{ variantId: medium, quantity: 2 }],
      }),
    );
    expect(yield* runOf(edgeUrl, productId)).toEqual({ claimed: 2, remaining: 1 });

    // Two larges would take the run to four. Refused, though L has 50 in stock.
    const overflow = yield* Effect.result(
      withShopper(catalogUrl, (client) =>
        client.placeOrder({
          commandId: cmd("l2"),
          email: `agg-${RUN}@spike.local`,
          destination: "CA",
          items: [{ variantId: large, quantity: 2 }],
        }),
      ),
    );
    show("E7 · aggregate refusal", overflow);
    expect(overflow._tag).toBe("Failure");
    if (overflow._tag === "Failure") {
      expect((overflow.failure as CartRefused).reason).toBe("preorder_full");
    }

    /**
     * AND THE LOSING CLAIM WAS HANDED BACK. A zero-row UPDATE does not abort a
     * D1 batch, so the run counter was incremented alongside the guard that
     * lost; if compensation missed it, the run would have silently shrunk to two
     * and the last place would be unsellable forever.
     */
    expect(yield* runOf(edgeUrl, productId)).toEqual({ claimed: 2, remaining: 1 });

    // The last place sells, in the other size.
    yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("l1"),
        email: `agg-${RUN}@spike.local`,
        destination: "CA",
        items: [{ variantId: large, quantity: 1 }],
      }),
    );
    expect(yield* runOf(edgeUrl, productId)).toEqual({ claimed: 3, remaining: 0 });

    // Per-variant stock never ran out — the run is what stopped the sale.
    expect(yield* stockOf(edgeUrl, productId, large)).toBe(49);
  }),
  { timeout: TEST_TIMEOUT },
);

test.skipIf(!STRIPE_READY)(
  "E8 · the reconcile heal records what was charged, not just that it was paid",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl, databaseName } = yield* stack;

    const { variantId } = yield* stockedProduct(edgeUrl, 5);
    const placed = yield* withShopper(catalogUrl, (client) =>
      client.placeOrder({
        commandId: cmd("heal"),
        email: `heal-${RUN}@spike.local`,
        destination: "CA",
        items: [{ variantId, quantity: 1 }],
      }),
    );

    /**
     * A REAL settled session, from the real API. `stripe trigger` confirms a
     * test-mode payment, so this session is genuinely `complete` and `paid` with
     * real amounts and a real payment intent behind it — exactly what
     * `payments.retrieve` will report.
     */
    yield* trigger("checkout.session.completed", null);
    const settled = yield* Effect.promise(async () => {
      const child = Bun.spawn(["stripe", "checkout", "sessions", "list", "--limit", "1"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out] = await Promise.all([new Response(child.stdout).text(), child.exited]);
      return (JSON.parse(out) as { data: Array<{ id: string }> }).data[0]!;
    });

    /**
     * THE ONE THING THAT IS ARRANGED: attach that session to our order and push
     * its expiry into the past. This is the state a LOST WEBHOOK leaves behind —
     * the buyer paid, the event never landed, and the sweep is the backstop that
     * is supposed to notice. There is no way to reach it from the public surface,
     * because there is no way to pay a checkout session from a script.
     *
     * Everything after this line is real.
     */
    yield* seed(
      databaseName,
      "update customer_order set session_id = ?, session_expires_at = ? where order_number = ?",
      [settled.id, Date.parse("2020-01-01T00:00:00Z"), placed.orderNumber],
    );

    const swept = yield* withOperator(edgeUrl, (client) => client.runSweep({}));
    show("E8 · sweep", swept);
    expect(swept.healed).toBe(1);

    const healed = yield* withOperator(edgeUrl, (client) =>
      client.getOrder({ orderNumber: placed.orderNumber }),
    );
    show("E8 · healed order", {
      status: healed.status,
      totalCents: healed.totalCents,
      currency: healed.currency,
    });

    // The label, which the heal already wrote.
    expect(healed.status).toBe("paid");
    expect(healed.paymentStatus).toBe("paid");

    /**
     * AND THE MONEY. A healed order that says `paid` with a total of zero is
     * worse than one still marked pending: every revenue and tax report reads it
     * as a sale of nothing, and the schema's own rule says to read `totalCents`
     * once an order is paid.
     */
    expect(healed.totalCents).toBeGreaterThan(0);

    /**
     * AND THE CHARGE. Without the payment intent there is NO join from a later
     * refund or dispute back to this order — charge events carry no session and
     * no metadata — so the money could go back and nothing here would know.
     */
    const [row] = yield* inspect<{ payment_intent_id: string | null }>(
      databaseName,
      "select payment_intent_id from customer_order where order_number = ?",
      [placed.orderNumber],
    );
    expect(row?.payment_intent_id).toBeTruthy();
  }),
  { timeout: TEST_TIMEOUT },
);
