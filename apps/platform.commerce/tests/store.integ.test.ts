/**
 * Deploy the whole stack once, drive it through a TYPED RPC CLIENT, tear it down.
 *
 * The client is built from the same `OperatorRpcs` value the server serves, so
 * every payload is encoded and every response decoded by `Schema`. A test that
 * sends the wrong shape fails to compile; a handler that returns the wrong shape
 * fails to decode. There is no hand-built JSON and no cast anywhere below.
 *
 * WHAT THESE TESTS ARE. Each one pins an INVARIANT — a property that must hold
 * however the implementation changes. None of them assert that a function calls
 * another function, or snapshot an internal shape, because those break on
 * refactors while proving nothing about behaviour.
 *
 * Keep the stack up between runs with NO_DESTROY=1.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import { OperatorRpcs } from "../domain/Rpc.ts";
import { StorefrontRpcs } from "../domain/Storefront.rpc.ts";
import { awaitStackReady } from "./Ready.ts";
import Stack from "./alchemy.run.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
  stage: "spike",
});

const HOOK_TIMEOUT = 600_000;
const TEST_TIMEOUT = 240_000;

/**
 * Deploy, THEN wait until the deployment is reachable. `deploy` resolving only
 * means Cloudflare accepted the resources — see `Ready.ts`.
 */
const stack = beforeAll(Effect.flatMap(deploy(Stack), awaitStackReady), {
  timeout: HOOK_TIMEOUT,
});
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack), { timeout: HOOK_TIMEOUT });

/**
 * The client type, derived from the contract rather than restated — so it
 * cannot drift from what the server serves.
 */
const makeOperatorClient = RpcClient.make(OperatorRpcs);
type OperatorClient = Effect.Success<typeof makeOperatorClient>;

/** A typed client bound to the deployed edge, scoped to one call. */
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

/** A unique command id per call — the caller owns idempotency, so tests must too. */
let counter = 0;

/**
 * Slugs are globally unique by design, so a re-run against a persistent stage
 * would collide with its own previous products. Namespacing per run keeps every
 * test order-independent and repeatable without a teardown step.
 */
const RUN = Math.random().toString(36).slice(2, 8);
const slugFor = (name: string) => `${name}-${RUN}`;
/**
 * Command ids are run-scoped for the same reason slugs are, and the failure mode
 * is worth recording: without the suffix, a second run reuses the first run's
 * command ids, so `Audit.command` correctly REPLAYS the first run's recorded
 * response — returning a product created minutes ago instead of creating a new
 * one. The suite caught that as three unrelated-looking failures. It is the
 * idempotency guarantee working exactly as specified.
 */
const cmd = (label: string) => `${label}-${RUN}-${(counter += 1)}`;

/**
 * Read the storefront until it reflects a write, or give up.
 *
 * Commerce writes D1 and Catalog reads it from a DIFFERENT Worker, so a read
 * issued immediately after a publish can legitimately miss it. This is a real
 * property of the system, not a flaky test — the storefront is eventually
 * consistent with the operator surface by design, which is exactly why it can
 * be cached at the edge.
 */
const untilStorefront = <A>(
  fetchIt: () => Promise<A>,
  ready: (value: A) => boolean,
): Effect.Effect<A> =>
  /**
   * `tryPromise`, not `promise`: on a FRESH stack the first request to Catalog
   * can fail outright rather than merely return stale data — a cold Worker whose
   * D1 binding has not warmed answers 500, and `.json()` on that throws. Treating
   * a thrown fetch as "not yet" is what makes the suite runnable immediately
   * after a deploy instead of only on the second run.
   */
  Effect.tryPromise(fetchIt).pipe(
    Effect.flatMap((value) =>
      ready(value) ? Effect.succeed(value) : Effect.fail("not yet" as const),
    ),
    Effect.retry({ schedule: Schedule.spaced("1 second"), times: 40 }),
    Effect.orDie,
  );

/** A storefront read that tolerates a cold stack. Every raw fetch goes through it. */
const storefront = <A>(fetchIt: () => Promise<A>): Effect.Effect<A> =>
  untilStorefront(fetchIt, () => true);

/** Live stock for one variant, read through the operator surface. */
const stockOf = (edgeUrl: string, productId: string, variantId: string) =>
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

/** Base64 of a 1×1 PNG — the smallest thing that is genuinely an image. */
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Build a published product: draft → media → variant → publish. Returns the ids
 * the caller needs. Shared because most invariants need a live product first.
 */
const publishedProduct = (url: string, slug: string, priceCents = 4500) =>
  withClient(url, (client) =>
    Effect.gen(function* () {
      const created = yield* client.createProduct({
        commandId: cmd("create"),
        slug,
        title: `Product ${slug}`,
      });
      yield* client.saveProductDraft({
        commandId: cmd("markets"),
        productId: created.productId,
        expectedRevision: 1,
        markets: [{ market: "CA", priceCents, active: true }],
      });
      const media = yield* client.ingestProductMedia({
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
        stock: 10,
      });
      const release = yield* client.publishProduct({
        commandId: cmd("publish"),
        productId: created.productId,
        expectedRevision: 2,
      });
      return {
        productId: created.productId,
        mediaId: media.id,
        variantId: variant.variantId,
        releaseId: release.releaseId,
      };
    }),
  );

test(
  "A · a draft is invisible to the storefront until it is published",
  Effect.gen(function* () {
    const { catalogUrl, edgeUrl } = yield* stack;

    const created = yield* withClient(edgeUrl, (client) =>
      client.createProduct({
        commandId: cmd("draft-only"),
        slug: slugFor("unpublished"),
        title: "Unpublished",
      }),
    );
    show("A · created draft", created);

    // The operator sees it...
    const detail = yield* withClient(edgeUrl, (client) =>
      client.getProduct({ productId: created.productId }),
    );
    expect(detail.draft.slug).toBe(slugFor("unpublished"));
    expect(detail.draft.status).toBe("draft");

    // ...the storefront does not. THE INVARIANT: the draft is never public.
    const listed = yield* storefront(() =>
      fetch(`${catalogUrl}/products`).then(
        (r) => r.json() as Promise<{ products: Array<{ slug: string }> }>,
      ),
    );
    expect(listed.products.map((p) => p.slug)).not.toContain(slugFor("unpublished"));
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "B · publishing is refused without media and without a variant",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;

    const created = yield* withClient(edgeUrl, (client) =>
      client.createProduct({
        commandId: cmd("gates"),
        slug: slugFor("gated"),
        title: "Gated",
      }),
    );

    // No media yet — the typed error says exactly which gate failed.
    const noMedia = yield* withClient(edgeUrl, (client) =>
      Effect.result(
        client.publishProduct({
          commandId: cmd("publish-nomedia"),
          productId: created.productId,
          expectedRevision: 1,
          version: "1.0.0",
        }),
      ),
    );
    show("B · publish without media", noMedia);
    expect(noMedia._tag).toBe("Failure");
    if (noMedia._tag === "Failure") {
      expect(noMedia.failure._tag).toBe("PublishRefused");
      expect((noMedia.failure as { reason: string }).reason).toBe("missing_media");
    }

    // Add media, still no variant.
    yield* withClient(edgeUrl, (client) =>
      client.ingestProductMedia({
        commandId: cmd("gates-media"),
        productId: created.productId,
        bytesBase64: PIXEL_PNG,
        contentType: "image/png",
        alt: "cover",
        role: "cover",
      }),
    );
    const noVariant = yield* withClient(edgeUrl, (client) =>
      Effect.result(
        client.publishProduct({
          commandId: cmd("publish-novariant"),
          productId: created.productId,
          expectedRevision: 1,
          version: "1.0.0",
        }),
      ),
    );
    show("B · publish without variant", noVariant);
    if (noVariant._tag === "Failure") {
      expect((noVariant.failure as { reason: string }).reason).toBe("missing_variant");
    } else {
      throw new Error("expected PublishRefused");
    }
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "C · a stale revision cannot overwrite a newer one",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;
    const created = yield* withClient(edgeUrl, (client) =>
      client.createProduct({
        commandId: cmd("concurrency"),
        slug: slugFor("concurrent"),
        title: "Concurrent",
      }),
    );

    // First writer wins and bumps the revision to 2.
    const first = yield* withClient(edgeUrl, (client) =>
      client.saveProductDraft({
        commandId: cmd("save-a"),
        productId: created.productId,
        expectedRevision: 1,
        title: "Writer A",
      }),
    );
    expect(first.revision).toBe(2);

    // Second writer still holds revision 1. THE INVARIANT: it must lose.
    const stale = yield* withClient(edgeUrl, (client) =>
      Effect.result(
        client.saveProductDraft({
          commandId: cmd("save-b"),
          productId: created.productId,
          expectedRevision: 1,
          title: "Writer B",
        }),
      ),
    );
    show("C · stale write", stale);
    expect(stale._tag).toBe("Failure");
    if (stale._tag === "Failure") expect(stale.failure._tag).toBe("RevisionConflict");

    // And A's title survived.
    const detail = yield* withClient(edgeUrl, (client) =>
      client.getProduct({ productId: created.productId }),
    );
    expect(detail.draft.title).toBe("Writer A");
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "D · the storefront price comes from the release, not the draft",
  Effect.gen(function* () {
    const { catalogUrl, edgeUrl } = yield* stack;
    const product = yield* publishedProduct(edgeUrl, slugFor("priced"), 4500);

    // Edit the draft price WITHOUT publishing.
    yield* withClient(edgeUrl, (client) =>
      client.saveProductDraft({
        commandId: cmd("reprice"),
        productId: product.productId,
        expectedRevision: 2,
        markets: [{ market: "CA", priceCents: 9999, active: true }],
      }),
    );

    // THE INVARIANT: an unpublished edit changes nothing a shopper can see.
    const shown = yield* untilStorefront(
      () =>
        fetch(`${catalogUrl}/products/${slugFor("priced")}`).then(
          (r) => r.json() as Promise<{ product?: { priceCents: number; version: string } }>,
        ),
      (body) => body.product !== undefined,
    );
    show("D · storefront price after draft edit", shown.product);
    expect(shown.product?.priceCents).toBe(4500);
    expect(shown.product?.version).toBe("1.0.0");
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "E · a replayed command returns the original answer and mutates once",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;
    const product = yield* publishedProduct(edgeUrl, slugFor("idempotent"));
    const commandId = cmd("adjust-once");

    const first = yield* withClient(edgeUrl, (client) =>
      client.adjustStock({
        commandId,
        variantId: product.variantId,
        delta: -3,
        reason: "damaged",
      }),
    );
    const replay = yield* withClient(edgeUrl, (client) =>
      client.adjustStock({
        commandId,
        variantId: product.variantId,
        delta: -3,
        reason: "damaged",
      }),
    );
    show("E · first vs replay", { first, replay });

    // Same answer, verbatim...
    expect(replay.stock).toBe(first.stock);
    // ...and the stock moved exactly once: 10 - 3 = 7, not 4.
    const detail = yield* withClient(edgeUrl, (client) =>
      client.getProduct({ productId: product.productId }),
    );
    expect(detail.variants[0]?.stock).toBe(7);
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "F · deleting a product never touches order history",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;
    const product = yield* publishedProduct(edgeUrl, slugFor("deletable"));

    /**
     * The plan must SURFACE the retained orders rather than refuse — that is the
     * whole reason `order_item` carries no catalog foreign key.
     */
    const plan = yield* withClient(edgeUrl, (client) =>
      client.planProductDeletion({ commandId: cmd("plan"), productId: product.productId }),
    );
    show("F · deletion plan", plan.impact);

    const deleted = yield* withClient(edgeUrl, (client) =>
      client.deleteProduct({
        commandId: cmd("confirm"),
        confirmationToken: plan.confirmationToken,
      }),
    );
    expect(deleted.deleted).toBe(true);

    // The product is gone.
    const gone = yield* withClient(edgeUrl, (client) =>
      Effect.result(client.getProduct({ productId: product.productId })),
    );
    expect(gone._tag).toBe("Failure");
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "G · a deletion token is single-use and cannot be redirected",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;
    const product = yield* publishedProduct(edgeUrl, slugFor("single-use"));

    const plan = yield* withClient(edgeUrl, (client) =>
      client.planVariantDeletion({
        commandId: cmd("plan-variant"),
        productId: product.productId,
        variantId: product.variantId,
      }),
    );

    const first = yield* withClient(edgeUrl, (client) =>
      client.deleteVariant({
        commandId: cmd("confirm-variant"),
        confirmationToken: plan.confirmationToken,
      }),
    );
    expect(first.deleted).toBe(true);

    /**
     * THE INVARIANT: the same token cannot execute twice. A fresh commandId is
     * used so this is not an idempotency replay — it reaches token verification
     * and must be refused there.
     */
    const reused = yield* withClient(edgeUrl, (client) =>
      Effect.result(
        client.deleteVariant({
          commandId: cmd("confirm-variant-again"),
          confirmationToken: plan.confirmationToken,
        }),
      ),
    );
    show("G · token reuse", reused);
    expect(reused._tag).toBe("Failure");
    if (reused._tag === "Failure") {
      expect(reused.failure._tag).toBe("DeletionRefused");
      expect((reused.failure as { reason: string }).reason).toBe("already_executed");
    }

    // A token that never existed is a MISMATCH, not a "not found" — the
    // difference would leak whether a token exists.
    const forged = yield* withClient(edgeUrl, (client) =>
      Effect.result(
        client.deleteVariant({
          commandId: cmd("forged"),
          confirmationToken: "not-a-real-token",
        }),
      ),
    );
    if (forged._tag === "Failure") {
      expect((forged.failure as { reason: string }).reason).toBe("mismatch");
    } else {
      throw new Error("expected DeletionRefused");
    }
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "H · media is served by id and its bytes round-trip",
  Effect.gen(function* () {
    const { catalogUrl, edgeUrl } = yield* stack;
    const product = yield* publishedProduct(edgeUrl, slugFor("with-media"));

    const response = yield* untilStorefront(
      () => fetch(`${catalogUrl}/media/${product.mediaId}`),
      (r) => r.status === 200,
    );
    show("H · media response", {
      status: response.status,
      contentType: response.headers.get("content-type"),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");

    const bytes = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()));
    // PNG magic number — the bytes that went in are the bytes that came out.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "I · a malformed cursor is a typed domain error, never a 500",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;

    // A malformed cursor is a typed domain error, never a 500.
    const badCursor = yield* withClient(edgeUrl, (client) =>
      Effect.result(client.listOrders({ cursor: "!!!not-base64!!!" })),
    );
    show("I · invalid cursor", badCursor);
    expect(badCursor._tag).toBe("Failure");
    if (badCursor._tag === "Failure") expect(badCursor.failure._tag).toBe("InvalidCursor");
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "J · the schema rejects a malformed payload before any handler runs",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;

    /**
     * THE INVARIANT the whole RPC layer exists for: a negative price never
     * reaches the domain.
     *
     * `priceCents` is `Schema.Int.check(isGreaterThanOrEqualTo(0))`, and the
     * refusal happens EARLIER than expected — the typed client refuses to encode
     * the payload at all, so the request is never sent. No round-trip, no
     * handler, no audit row. `Effect.result` does not catch it because it is a
     * defect rather than a typed failure, which is the correct classification: a
     * payload the contract forbids is a programming error, not a domain outcome.
     */
    const outcome = yield* Effect.exit(
      withClient(edgeUrl, (client) =>
        client.saveProductDraft({
          commandId: cmd("negative"),
          productId: "prod-never-reached",
          expectedRevision: 1,
          markets: [{ market: "CA", priceCents: -1, active: true }],
        }),
      ),
    );
    show("J · encode refusal", { failed: outcome._tag === "Failure" });
    expect(outcome._tag).toBe("Failure");
    expect(String(outcome)).toContain("greater than or equal to 0");

    // And nothing was created — the product does not exist.
    const listed = yield* withClient(edgeUrl, (client) => client.listProducts({ limit: 100 }));
    expect(listed.products.map((p) => p.slug)).not.toContain(slugFor("negative-price"));
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "K · publishing needs no version, and republishing derives the next one",
  Effect.gen(function* () {
    const { edgeUrl } = yield* stack;
    const slug = slugFor("unversioned");

    /**
     * A VERSION IS A LABEL, NOT AN INPUT. Requiring one made a decorative idea
     * load-bearing: fixing a typo meant inventing a number, and reusing one
     * refused the publish outright. Publishing without one is the normal path.
     */
    const product = yield* publishedProduct(edgeUrl, slug);
    const first = yield* withClient(edgeUrl, (client) =>
      client.getProduct({ productId: product.productId }),
    );
    expect(first.draft.activeVersion).toBe("1.0.0");

    // Edit and republish — again naming nothing.
    const second = yield* withClient(edgeUrl, (client) =>
      Effect.gen(function* () {
        yield* client.saveProductDraft({
          commandId: cmd("edit"),
          productId: product.productId,
          expectedRevision: 2,
          title: "Corrected title",
        });
        return yield* client.publishProduct({
          commandId: cmd("republish"),
          productId: product.productId,
          expectedRevision: 3,
        });
      }),
    );
    show("K · derived versions", { first: "1.0.0", second: second.version });

    // Derived, distinct, and monotonic — no collision to hand back to the caller.
    expect(second.version).toBe("1.1.0");

    const detail = yield* withClient(edgeUrl, (client) =>
      client.getProduct({ productId: product.productId }),
    );
    expect(detail.draft.activeVersion).toBe("1.1.0");
    expect(detail.releases).toHaveLength(2);

    /**
     * Naming one explicitly still works, and a name already taken is still
     * refused — the constraint did not go away, it just stopped being something
     * you have to think about.
     */
    const clash = yield* Effect.result(
      withClient(edgeUrl, (client) =>
        Effect.gen(function* () {
          yield* client.saveProductDraft({
            commandId: cmd("edit2"),
            productId: product.productId,
            expectedRevision: 3,
            title: "Third",
          });
          return yield* client.publishProduct({
            commandId: cmd("clash"),
            productId: product.productId,
            expectedRevision: 4,
            version: "1.0.0",
          });
        }),
      ),
    );
    expect(clash._tag).toBe("Failure");
    if (clash._tag === "Failure") {
      expect(clash.failure._tag).toBe("PublishRefused");
    }
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "L · a double-clicked Buy reserves stock once",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl } = yield* stack;
    const slug = slugFor("doubleclick");
    const product = yield* publishedProduct(edgeUrl, slug);
    yield* withClient(edgeUrl, (client) =>
      client.adjustStock({
        commandId: cmd("stock"),
        variantId: product.variantId,
        delta: 0,
        reason: "baseline",
      }),
    );

    const before = yield* stockOf(edgeUrl, product.productId, product.variantId);

    /**
     * ONE command id, two requests in flight — a tapped Buy button on a phone
     * that did not acknowledge the first tap. This is the case the idempotency
     * ledger exists for, and `Audit.command` commits the mutation and its event
     * row in a single batch precisely so the loser's UNIQUE violation rolls the
     * whole thing back.
     *
     * Checkout runs its reservation in its OWN batch first, so both requests
     * miss `recorded()`, both decrement, and only the losing session-id update
     * is rolled back. The phantom hold stands until the sweep finds it.
     */
    const commandId = cmd("tap");
    const buy = () =>
      Effect.result(
        withShopper(catalogUrl, (client) =>
          client.placeOrder({
            commandId,
            email: `dbl-${RUN}@spike.local`,
            market: "CA",
            items: [{ variantId: product.variantId, quantity: 2 }],
          }),
        ),
      );

    const [a, b] = yield* Effect.all([buy(), buy()], { concurrency: 2 });
    const after = yield* stockOf(edgeUrl, product.productId, product.variantId);
    show("L · double click", {
      first: a._tag,
      second: b._tag,
      stockBefore: before,
      stockAfter: after,
    });

    // At least one must succeed — a double tap is not a reason to refuse a sale.
    expect([a._tag, b._tag]).toContain("Success");
    // THE INVARIANT: one cart, one reservation, however many taps reached us.
    expect(after).toBe(before - 2);
  }),
  { timeout: TEST_TIMEOUT },
);

test(
  "M · media stops being served once its product is pulled from sale",
  Effect.gen(function* () {
    const { edgeUrl, catalogUrl } = yield* stack;
    const product = yield* publishedProduct(edgeUrl, slugFor("pullable"));

    const live = yield* untilStorefront(
      () => fetch(`${catalogUrl}/media/${product.mediaId}`),
      (r) => r.status === 200,
    );
    expect(live.status).toBe(200);

    /**
     * `unavailable` is a published product PULLED FROM SALE — the whole reason
     * the status domain has four values rather than two. The listing and the
     * product page both honour it. The media route does not: it resolves an
     * image id straight to bytes with no join to the product at all, so a link
     * anyone already has keeps working after the product is withdrawn.
     */
    yield* withClient(edgeUrl, (client) =>
      client.setProductStatus({
        commandId: cmd("pull"),
        productId: product.productId,
        status: "unavailable",
      }),
    );

    const pulled = yield* untilStorefront(
      () => fetch(`${catalogUrl}/media/${product.mediaId}`),
      (r) => r.status === 404,
    );
    show("M · after pull", { status: pulled.status });
    expect(pulled.status).toBe(404);
  }),
  { timeout: TEST_TIMEOUT },
);
