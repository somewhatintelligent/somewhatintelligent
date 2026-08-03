/**
 * THE COMMERCE SURFACE — the 30 methods, and nothing about how they are hosted.
 *
 * Split out of `Commerce.ts` so the worker that serves it can be declared TWICE
 * with two different payment providers behind it:
 *
 *   workers/Commerce.ts        the real one. Stripe or nothing.
 *   tests/workers/Commerce.ts  the test one, which may fall back to the fake.
 *
 * The split exists because the fake provider is a test double and must not be
 * reachable from anything `module.ts` deploys — not at runtime, and not in the
 * import graph either. A single worker choosing its provider with an `if` puts
 * `PaymentsFake` in the production bundle no matter which branch runs, and
 * `fake_session` in the production schema. Two entrypoints make the separation
 * structural: the deployed worker cannot name the fake, so it cannot ship it.
 *
 * NOTHING HERE KNOWS WHICH PROVIDER IT GOT. It takes a resolved `Provider` and
 * layers it over the shared capabilities — which is the same property the seam
 * always had, now enforced by the module boundary rather than by a comment.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Catalog from "../domain/Catalog.ts";
import type {
  AdjustStockInput,
  ConfirmDeletionInput,
  CreateProductInput,
  IngestProductMediaInput,
  ListProductsInput,
  OperatorCall,
  OrderListInput,
  PlanProductReleaseDeletionInput,
  ProductStatus,
  PublishProductInput,
  PutVariantInput,
  ReorderProductMediaInput,
  SaveProductDraftInput,
  SetOrderStatusInput,
  FulfillOrderInput,
} from "../domain/Contracts.ts";
import * as Checkout from "../domain/Checkout.ts";
import * as Deletion from "../domain/Deletion.ts";
import * as Media from "../domain/Media.ts";
import * as Orders from "../domain/Orders.ts";
import * as Storefront from "../domain/Storefront.ts";
import * as Timeline from "../domain/Timeline.ts";
import { capabilities, handles } from "../runtime.ts";
import { Audit } from "../services/Audit.ts";
import { Database } from "../services/Database.ts";
import { Ids } from "../services/Ids.ts";
import type { Provider } from "../services/PaymentsProvider.ts";

export const commerceSurface = Effect.fn("commerceSurface")(function* (provider: Provider) {
  const resolved = yield* handles;
  const layer = Layer.provideMerge(provider.layer, capabilities(resolved));

  /**
   * Every mutating method follows the same shape: resolve the services, run
   * the pure core, hand its outcome to `Audit.command`. The uniformity is the
   * point — no method can quietly skip the idempotency check, because the
   * commit only happens inside `command`.
   *
   * Reads bypass `command` entirely: they take no idempotency key and write no
   * event, because they have nothing to replay and nothing to record.
   */
  const surface = {
    listProducts: (call: OperatorCall<ListProductsInput>) =>
      Effect.gen(function* () {
        const database = yield* Database;
        const outcome = yield* Catalog.listProducts(database.db, call.input);
        return "failure" in outcome ? outcome.failure : outcome.response;
      }).pipe(Effect.provide(layer)),

    getProduct: (call: OperatorCall<{ productId: string }>) =>
      Effect.gen(function* () {
        const database = yield* Database;
        const outcome = yield* Catalog.getProduct(database.db, call.input.productId);
        return "failure" in outcome ? outcome.failure : outcome.response;
      }).pipe(Effect.provide(layer)),

    createProduct: (call: OperatorCall<CreateProductInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        const ids = yield* Ids;
        return yield* audit.command(
          "createProduct",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            const productId = yield* ids.next();
            return yield* Catalog.createProduct(
              database.db,
              call.input,
              call.meta.actor.sub,
              now,
              productId,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    saveProductDraft: (call: OperatorCall<SaveProductDraftInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "saveProductDraft",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Catalog.saveProductDraft(
              database.db,
              call.input,
              call.meta.actor.sub,
              now,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    publishProduct: (call: OperatorCall<PublishProductInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        const ids = yield* Ids;
        return yield* audit.command(
          "publishProduct",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            const releaseId = yield* ids.next();
            return yield* Catalog.publishProduct(
              database.db,
              call.input,
              call.meta.actor.sub,
              now,
              releaseId,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    setProductStatus: (call: OperatorCall<{ productId: string; status: ProductStatus }>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "setProductStatus",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Catalog.setProductStatus(
              database.db,
              call.input.productId,
              call.input.status,
              now,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    putVariant: (call: OperatorCall<PutVariantInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        const ids = yield* Ids;
        return yield* audit.command(
          "putVariant",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            const variantId = yield* ids.next();
            return yield* Catalog.putVariant(database.db, call.input, now, variantId);
          }),
        );
      }).pipe(Effect.provide(layer)),

    setPreorderCap: (call: OperatorCall<{ productId: string; cap: number | null }>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "setPreorderCap",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Catalog.setPreorderCap(database.db, call.input, now);
          }),
        );
      }).pipe(Effect.provide(layer)),

    adjustStock: (call: OperatorCall<AdjustStockInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "adjustStock",
          call,
          Catalog.adjustStock(database.db, call.input),
        );
      }).pipe(Effect.provide(layer)),

    ingestProductMedia: (call: OperatorCall<IngestProductMediaInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        const ids = yield* Ids;
        return yield* audit.command(
          "ingestProductMedia",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            const imageId = yield* ids.next();
            return yield* Media.ingestProductMedia(database.db, call.input, now, imageId);
          }),
        );
      }).pipe(Effect.provide(layer)),

    /**
     * The bytes behind a media id, at ANY product status, as a STREAM. A read —
     * no audit row, no idempotency key, no envelope.
     *
     * The console needs it because publish refuses without a cover and the
     * public `/media/:id` refuses until the product is active, so the whole
     * pre-publish window is a hole the public route cannot serve. See
     * `domain/Media.ts` for why that gate stays exactly as it is and why this
     * being binding-only is what makes a second reader safe.
     *
     * An empty stream for a miss, because the bridge types a stream method as
     * `Promise<ReadableStream>` and has no null to give. The caller pairs this
     * with {@link operatorMediaContentType}, whose `null` IS the 404 signal.
     */
    streamOperatorMedia: (mediaId: string) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const database = yield* Database;
          const blob = yield* Media.openOperatorMedia(database.db, mediaId);
          return blob === null
            ? Stream.empty
            : Stream.fromReadableStream({
                evaluate: () => blob.body,
                onError: (error) => error,
              });
        }).pipe(Effect.provide(layer)),
      ),

    /** The content type for {@link streamOperatorMedia}, and its existence check. */
    operatorMediaContentType: (mediaId: string) =>
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* Media.operatorMediaContentType(database.db, mediaId);
      }).pipe(Effect.provide(layer)),

    reorderProductMedia: (call: OperatorCall<ReorderProductMediaInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "reorderProductMedia",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Catalog.reorderProductMedia(database.db, call.input, now);
          }),
        );
      }).pipe(Effect.provide(layer)),

    listOrders: (call: OperatorCall<OrderListInput>) =>
      Effect.gen(function* () {
        const database = yield* Database;
        const outcome = yield* Orders.listOrders(database.db, call.input);
        return "failure" in outcome ? outcome.failure : outcome.response;
      }).pipe(Effect.provide(layer)),

    getOrder: (call: OperatorCall<{ orderNumber: string }>) =>
      Effect.gen(function* () {
        const database = yield* Database;
        const outcome = yield* Orders.getOrder(database.db, call.input.orderNumber);
        return "failure" in outcome ? outcome.failure : outcome.response;
      }).pipe(Effect.provide(layer)),

    /** Both audit logs for one order, merged. A read — nothing is recorded. */
    orderTimeline: (orderNumber: string) =>
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* Timeline.orderTimeline(database.db, orderNumber);
      }).pipe(Effect.provide(layer)),

    setOrderStatus: (call: OperatorCall<SetOrderStatusInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "setOrderStatus",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Orders.setOrderStatus(database.db, call.input, now);
          }),
        );
      }).pipe(Effect.provide(layer)),

    fulfillOrder: (call: OperatorCall<FulfillOrderInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "fulfillOrder",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Orders.fulfillOrder(database.db, call.input, now);
          }),
        );
      }).pipe(Effect.provide(layer)),

    markDelivered: (call: OperatorCall<{ orderNumber: string }>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "markDelivered",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Orders.markDelivered(database.db, call.input.orderNumber, now);
          }),
        );
      }).pipe(Effect.provide(layer)),

    /**
     * The plan side is NOT idempotency-guarded: every call mints a fresh token
     * and a fresh intent row. Only `delete*` is guarded, which is how
     * single-use tokens and safe retries coexist.
     */
    planProductReleaseDeletion: (call: OperatorCall<PlanProductReleaseDeletionInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "planProductReleaseDeletion",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Deletion.planProductReleaseDeletion(
              database.db,
              call.input,
              call.meta.actor.sub,
              now,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    deleteProductRelease: (call: OperatorCall<ConfirmDeletionInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "deleteProductRelease",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Deletion.deleteProductRelease(
              database.db,
              call.input.confirmationToken,
              call.meta.actor.sub,
              now,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    planProductDeletion: (call: OperatorCall<{ productId: string }>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "planProductDeletion",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Deletion.planProductDeletion(
              database.db,
              call.input.productId,
              call.meta.actor.sub,
              now,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    deleteProduct: (call: OperatorCall<ConfirmDeletionInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "deleteProduct",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Deletion.deleteProduct(
              database.db,
              call.input.confirmationToken,
              call.meta.actor.sub,
              now,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    planVariantDeletion: (call: OperatorCall<{ productId: string; variantId: string }>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "planVariantDeletion",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Deletion.planVariantDeletion(
              database.db,
              call.input,
              call.meta.actor.sub,
              now,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    deleteVariant: (call: OperatorCall<ConfirmDeletionInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "deleteVariant",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Deletion.deleteVariant(
              database.db,
              call.input.confirmationToken,
              call.meta.actor.sub,
              now,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    planProductMediaDeletion: (call: OperatorCall<{ productId: string; mediaId: string }>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "planProductMediaDeletion",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Deletion.planProductMediaDeletion(
              database.db,
              call.input,
              call.meta.actor.sub,
              now,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),

    deleteProductMedia: (call: OperatorCall<ConfirmDeletionInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        const database = yield* Database;
        return yield* audit.command(
          "deleteProductMedia",
          call,
          Effect.gen(function* () {
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
            return yield* Deletion.deleteProductMedia(
              database.db,
              call.input.confirmationToken,
              call.meta.actor.sub,
              now,
            );
          }),
        );
      }).pipe(Effect.provide(layer)),
  };

  /**
   * THE CUSTOMER METHODS, spread on separately.
   *
   * Checkout is what a shopper does, not an operator capability, so it sits in
   * its own object and behind its own contract (`Domain/Storefront.rpc.ts`).
   * Same D1, same batch, same audit ledger; different caller, different
   * blast radius if the authorization in front of it is wrong.
   *
   * Both still travel a BINDING. The customer-facing decode happens on Catalog,
   * which is the worker a browser can reach; this stays unaddressed.
   */
  const storefront = {
    placeOrder: (call: OperatorCall<Checkout.PlaceOrderInput>) =>
      Effect.gen(function* () {
        const audit = yield* Audit;
        return yield* audit.claimed("placeOrder", call, (claim) =>
          Checkout.placeOrder(call.input, claim),
        );
      }).pipe(Effect.provide(layer)),

    /**
     * The customer's own order, and ONLY if they can name the address it was
     * placed with. Commerce enforces the match rather than the edge, because
     * an authorization check that lives on the caller's side is one refactor
     * away from being skipped.
     */
    getCustomerOrder: (orderNumber: string, email: string) =>
      Effect.gen(function* () {
        const database = yield* Database;
        const outcome = yield* Orders.getOrder(database.db, orderNumber);
        if ("failure" in outcome) return outcome.failure;
        const found = outcome.response;
        if (!found.ok) return found;
        /**
         * EITHER ADDRESS OPENS THE ORDER. One is what they typed on the
         * storefront, the other what they gave the payment page — a buyer who
         * used their work address at checkout still owns this order, and
         * telling them it does not exist because they quoted the wrong one of
         * their own two addresses is a support ticket, not security.
         *
         * Case-insensitive, because addresses are not case-sensitive in
         * practice and a retyped capital is not a different person.
         */
        const asked = email.trim().toLowerCase();
        const owns =
          found.value.email.toLowerCase() === asked ||
          found.value.receiptEmail?.toLowerCase() === asked;
        return owns ? found : { ok: false as const, error: "not_found" as const };
      }).pipe(Effect.provide(layer)),

    /**
     * The storefront READ MODEL, over the binding.
     *
     * These two were previously reachable only from inside Catalog's HTTP
     * handlers, which meant a bound sibling — an SSR storefront, the console
     * in `console/` — had no way to read the catalog except by making an HTTP
     * request to a worker built for browsers. Catalog still serves them over
     * HTTP, because those routes are cacheable and linkable and a browser
     * wants them; this is the same read for a caller that holds a binding.
     *
     * Sourced from the ACTIVE RELEASE, like everything else a shopper sees.
     * `listProducts`/`getProduct` above are the OPERATOR reads — draft-aware,
     * envelope-wrapped — and are not interchangeable with these.
     */
    listStorefront: () =>
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* Storefront.listActiveProducts(database.db);
      }).pipe(Effect.provide(layer)),

    getStorefrontProduct: (slug: string) =>
      Effect.gen(function* () {
        const database = yield* Database;
        return yield* Storefront.getActiveProductBySlug(database.db, slug);
      }).pipe(Effect.provide(layer)),

    /** What provider this deployment mints sessions with — asserted by the suite. */
    paymentsProvider: () => Effect.succeed(provider.kind),
  };

  /**
   * No `satisfies OperatorSurface` check here, deliberately.
   *
   * A hand-written interface restating these method signatures validates
   * nothing at runtime and makes every change a two-file edit — the same
   * "assert the code is the code" trap as a test that snapshots a shape. The
   * contract that DOES earn its keep is `Domain/Rpc.ts`, which decodes real
   * payloads at the boundary and fails loudly when the implementation drifts
   * from it.
   */
  return { ...surface, ...storefront };
});
