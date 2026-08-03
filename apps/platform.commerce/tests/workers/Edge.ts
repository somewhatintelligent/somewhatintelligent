/**
 * TEST-ONLY. Not deployed, and it must never be — see `tests/alchemy.run.ts`,
 * which is the only stack that declares it.
 *
 * WHAT THIS IS. The operator surface over HTTP, so a test process can drive a
 * deployed stack. In the platform there is no mutation over HTTP: the operator
 * console binds Commerce directly with `bindWorker`, and those calls travel
 * Cloudflare's in-account service-binding fabric by structured clone — no JSON,
 * no HTTP, no decode. Alchemy's guidance is explicit that Worker-to-Worker calls
 * use SCHEMALESS RPC and that Effect RPC is for crossing a TRUST BOUNDARY.
 *
 * A test cannot use a service binding — it is not a Worker — so it needs
 * ingress, and this is the shape ingress should take when it exists at all:
 * `RpcServer.toHttpEffect(OperatorRpcs)`, where every payload is `Schema`-decoded,
 * every failure a client sees is a tagged error it can match on, and there is not
 * a single cast in the file. Contrast the hop below it —
 * `commerce.createProduct(call)` — which needs no validation precisely because
 * only a bound caller can reach it.
 *
 * WHY IT IS NOT IN `workers/`. `SPIKE_ACTOR` below is a constant. Every mutation
 * this worker forwards is therefore attributed to a fabricated operator, and
 * anyone who can reach the URL is that operator. Under `alchemy dev` and a
 * throwaway test stage that is a fixture; deployed, it is unauthenticated write
 * access to the entire catalogue and order book. The platform's operator console
 * replaces the constant with a session read and keeps the binding — which is why
 * `Commerce` has no address of its own.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import {
  deriveIdempotencyKey,
  type DomainResult,
  type OperatorActor,
  type OperatorCall,
} from "../../domain/Contracts.ts";
import {
  DeletionRefused,
  InvalidCursor,
  InvalidPrice,
  MediaRefused,
  NotFound,
  OperatorRpcs,
  OrderRefused,
  PreorderRefused,
  PublishRefused,
  RevisionConflict,
  SlugTaken,
  VariantRefused,
} from "../../domain/Rpc.ts";
import CommerceWorker from "./Commerce.ts";
import SettlementWorker from "./Settlement.ts";

/**
 * A FABRICATED OPERATOR, and the single reason this file lives under `tests/`.
 *
 * The shape is what an operator console has to produce: a stable subject plus a
 * verified email, minted server-side and never accepted from the browser.
 * Producing it from a constant rather than a session is what makes this worker a
 * fixture — every mutation the suite drives is attributed here, which is exactly
 * what a test wants and exactly what a deployment must not have.
 *
 * The platform's operator console replaces this constant with a session read and
 * drops the HTTP hop entirely, binding Commerce directly.
 */
const SPIKE_ACTOR: OperatorActor = {
  sub: "operator:spike",
  email: "operator@spike.local",
};

/** Build the envelope Commerce expects. The browser supplies only `commandId`. */
const envelope = <T>(action: string, commandId: string, input: T): OperatorCall<T> => ({
  input,
  meta: {
    actor: SPIKE_ACTOR,
    requestId: commandId,
    idempotencyKey: deriveIdempotencyKey(SPIKE_ACTOR.sub, action, commandId),
  },
});

/** Reads carry no command id — there is nothing to replay. */
const readEnvelope = <T>(action: string, input: T): OperatorCall<T> =>
  envelope(action, `read:${action}`, input);

export default class EdgeWorker extends Cloudflare.Worker<EdgeWorker>()(
  "Edge",
  { main: import.meta.url },
  Effect.gen(function* () {
    const commerce = yield* Cloudflare.Workers.bindWorker(CommerceWorker);
    const settlement = yield* Cloudflare.Workers.bindWorker(SettlementWorker);

    /**
     * Lift a `DomainResult` onto the typed error channel.
     *
     * The domain cores keep returning results as VALUES — that is what lets a
     * failure skip the audit write without unwinding a batch. This is the one
     * place that translation happens, so no handler restates it.
     */
    const lift = <T, E extends string, F>(
      result: DomainResult<T, E>,
      toError: (error: E, message: string | undefined) => F,
    ): Effect.Effect<T, F> =>
      result.ok ? Effect.succeed(result.value) : Effect.fail(toError(result.error, result.message));

    const notFound = (what: string, id: string) => () => new NotFound({ what, id });

    const handlers = OperatorRpcs.toLayer({
      listProducts: (payload) =>
        Effect.flatMap(commerce.listProducts(readEnvelope("listProducts", payload)), (result) =>
          lift(result, () => new InvalidCursor({ cursor: payload.cursor ?? "" })),
        ),

      getProduct: (payload) =>
        Effect.flatMap(commerce.getProduct(readEnvelope("getProduct", payload)), (result) =>
          lift(result, notFound("product", payload.productId)),
        ),

      createProduct: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.createProduct(envelope("createProduct", commandId, input)),
          (result) =>
            lift(result, (error) =>
              error === "slug_taken"
                ? new SlugTaken({ slug: input.slug })
                : new InvalidPrice({ priceCents: input.priceCents }),
            ),
        ),

      saveProductDraft: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.saveProductDraft(envelope("saveProductDraft", commandId, input)),
          (result) =>
            lift(result, (error) => {
              if (error === "not_found")
                return new NotFound({ what: "product", id: input.productId });
              if (error === "revision_conflict")
                return new RevisionConflict({ expected: input.expectedRevision });
              if (error === "slug_taken") return new SlugTaken({ slug: input.slug ?? "" });
              return new InvalidPrice({ priceCents: input.priceCents ?? 0 });
            }),
        ),

      publishProduct: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.publishProduct(envelope("publishProduct", commandId, input)),
          (result) =>
            lift(result, (error) => {
              if (error === "not_found")
                return new NotFound({ what: "product", id: input.productId });
              if (error === "revision_conflict")
                return new RevisionConflict({ expected: input.expectedRevision });
              return new PublishRefused({ reason: error });
            }),
        ),

      setProductStatus: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.setProductStatus(envelope("setProductStatus", commandId, input)),
          (result) =>
            lift(result, (error) =>
              error === "not_found"
                ? new NotFound({ what: "product", id: input.productId })
                : new PublishRefused({ reason: "no_release" }),
            ),
        ),

      putVariant: ({ commandId, ...input }) =>
        Effect.flatMap(commerce.putVariant(envelope("putVariant", commandId, input)), (result) =>
          lift(result, (error) =>
            error === "not_found"
              ? new NotFound({ what: "product", id: input.productId })
              : new VariantRefused({ reason: error }),
          ),
        ),

      setPreorderCap: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.setPreorderCap(envelope("setPreorderCap", commandId, input)),
          (result) =>
            lift(result, (error, detail) =>
              error === "not_found"
                ? new NotFound({ what: "product", id: input.productId })
                : new PreorderRefused({ reason: error, detail }),
            ),
        ),

      adjustStock: ({ commandId, ...input }) =>
        Effect.flatMap(commerce.adjustStock(envelope("adjustStock", commandId, input)), (result) =>
          lift(result, (error) =>
            error === "not_found"
              ? new NotFound({ what: "variant", id: input.variantId })
              : new VariantRefused({ reason: error }),
          ),
        ),

      /**
       * Bytes arrive base64 because the RPC wire has no binary frame — the
       * schema says so explicitly rather than leaving it to a convention.
       */
      ingestProductMedia: ({ commandId, bytesBase64, ...rest }) =>
        Effect.flatMap(
          Effect.sync(() => {
            const binary = atob(bytesBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            return bytes.buffer;
          }),
          (buffer) =>
            Effect.flatMap(
              commerce.ingestProductMedia(
                envelope("ingestProductMedia", commandId, { ...rest, bytes: buffer }),
              ),
              (result) =>
                lift(result, (error, detail) =>
                  error === "not_found"
                    ? new NotFound({ what: "product", id: rest.productId })
                    : new MediaRefused({ reason: error, detail }),
                ),
            ),
        ),

      reorderProductMedia: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.reorderProductMedia(
            envelope("reorderProductMedia", commandId, {
              ...input,
              mediaIds: [...input.mediaIds],
            }),
          ),
          (result) =>
            lift(result, (error) =>
              error === "not_found"
                ? new NotFound({ what: "product", id: input.productId })
                : new MediaRefused({ reason: "invalid_order" }),
            ),
        ),

      listOrders: (payload) =>
        Effect.flatMap(commerce.listOrders(readEnvelope("listOrders", payload)), (result) =>
          lift(result, () => new InvalidCursor({ cursor: payload.cursor ?? "" })),
        ),

      getOrder: (payload) =>
        Effect.flatMap(commerce.getOrder(readEnvelope("getOrder", payload)), (result) =>
          lift(result, notFound("order", payload.orderNumber)),
        ),

      orderTimeline: ({ orderNumber }) =>
        Effect.flatMap(commerce.orderTimeline(orderNumber), (entries) =>
          entries === null
            ? Effect.fail(new NotFound({ what: "order", id: orderNumber }))
            : Effect.succeed(entries),
        ),

      setOrderStatus: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.setOrderStatus(envelope("setOrderStatus", commandId, input)),
          (result) =>
            lift(result, (error, detail) =>
              error === "not_found"
                ? new NotFound({ what: "order", id: input.orderNumber })
                : new OrderRefused({ reason: error, detail }),
            ),
        ),

      fulfillOrder: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.fulfillOrder(envelope("fulfillOrder", commandId, input)),
          (result) =>
            lift(result, (error, detail) =>
              error === "not_found"
                ? new NotFound({ what: "order", id: input.orderNumber })
                : new OrderRefused({ reason: error, detail }),
            ),
        ),

      markDelivered: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.markDelivered(envelope("markDelivered", commandId, input)),
          (result) =>
            lift(result, (error, detail) =>
              error === "not_found"
                ? new NotFound({ what: "order", id: input.orderNumber })
                : new OrderRefused({ reason: error, detail }),
            ),
        ),

      planProductReleaseDeletion: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.planProductReleaseDeletion(
            envelope("planProductReleaseDeletion", commandId, input),
          ),
          (result) =>
            lift(result, (error) =>
              error === "not_found"
                ? new NotFound({ what: "release", id: input.releaseId })
                : new DeletionRefused({ reason: "invalid_replacement" }),
            ),
        ),

      deleteProductRelease: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.deleteProductRelease(envelope("deleteProductRelease", commandId, input)),
          (result) => lift(result, deletionError("release")),
        ),

      planProductDeletion: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.planProductDeletion(envelope("planProductDeletion", commandId, input)),
          (result) => lift(result, notFound("product", input.productId)),
        ),

      deleteProduct: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.deleteProduct(envelope("deleteProduct", commandId, input)),
          (result) => lift(result, deletionError("product")),
        ),

      planVariantDeletion: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.planVariantDeletion(envelope("planVariantDeletion", commandId, input)),
          (result) => lift(result, notFound("variant", input.variantId)),
        ),

      deleteVariant: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.deleteVariant(envelope("deleteVariant", commandId, input)),
          (result) => lift(result, deletionError("variant")),
        ),

      planProductMediaDeletion: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.planProductMediaDeletion(envelope("planProductMediaDeletion", commandId, input)),
          (result) => lift(result, notFound("media", input.mediaId)),
        ),

      deleteProductMedia: ({ commandId, ...input }) =>
        Effect.flatMap(
          commerce.deleteProductMedia(envelope("deleteProductMedia", commandId, input)),
          (result) => lift(result, deletionError("media")),
        ),

      runSweep: () => settlement.sweepNow(),
      replayEvent: ({ event, attempt }) => settlement.settleNow(event, attempt),
    });

    /**
     * The server is built INSIDE the request, not at init.
     *
     * Its handlers call Commerce over the binding, and those calls require
     * `RuntimeContext` — a per-event service. Building the layer in the init
     * closure would demand that context one phase before it exists, which is
     * the same constraint that keeps the batch handle a Layer over in
     * `Services/Database.ts`. `HttpEffect` explicitly admits `RuntimeContext` in
     * its requirement, so doing it here typechecks and needs no discharge.
     */
    return {
      fetch: Effect.gen(function* () {
        const server = yield* RpcServer.toHttpEffect(OperatorRpcs).pipe(
          Effect.provide(Layer.mergeAll(handlers, RpcSerialization.layerNdjson)),
        );
        return yield* server;
      }),
    };
  }),
) {}

/**
 * Every confirm-delete refusal, mapped once.
 *
 * `mismatch` deliberately absorbs unknown token, wrong operator and wrong
 * action: distinguishing them for a friendlier message would leak whether a
 * token exists and who owns it.
 */
const deletionError =
  (what: string) =>
  (error: string, _message: string | undefined): NotFound | DeletionRefused => {
    switch (error) {
      case "not_found":
        return new NotFound({ what, id: "" });
      case "deletion_plan_expired":
        return new DeletionRefused({ reason: "expired" });
      case "deletion_already_executed":
        return new DeletionRefused({ reason: "already_executed" });
      case "deletion_plan_drift":
        return new DeletionRefused({ reason: "drift" });
      default:
        return new DeletionRefused({ reason: "mismatch" });
    }
  };
