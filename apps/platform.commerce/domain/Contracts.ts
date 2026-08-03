/**
 * The store's domain contract: the call envelope, the result envelope, and every
 * DTO that crosses an RPC boundary. Nothing here touches D1 or Effect — it is
 * the vocabulary both sides of the binding agree on.
 *
 * Two rules govern the whole file:
 *
 *  - `meta` is minted SERVER-SIDE, after the edge has validated the caller. No
 *    browser-facing input type may carry `actor` or `meta`; the browser supplies
 *    only a `commandId`, which is namespaced by actor and action before it
 *    becomes a domain idempotency key — so a client cannot assert an identity by
 *    choosing a key. See {@link deriveIdempotencyKey}.
 *  - No method ever throws for a domain condition. Success and typed domain
 *    errors are both {@link DomainResult} values.
 */
import type * as Rpc from "./Rpc.ts";
import type * as StorefrontRpc from "./Storefront.rpc.ts";
import type { Bump } from "../core/versions.ts";

// ── Result envelope ──────────────────────────────────────────────────────────

/**
 * The envelope itself lives in `core/` — it is pure, and every rule about it
 * (notably `err`'s byte-stable key omission) is provable without a database.
 * Re-exported here so this file stays the one vocabulary import for callers.
 */
import { deriveIdempotencyKey } from "../core/result.ts";

export { deriveIdempotencyKey, err, ok, type DomainResult } from "../core/result.ts";

// ── Call envelope ────────────────────────────────────────────────────────────

export interface OperatorActor {
  /** Stable subject from the edge's identity check. */
  sub: string;
  /** Verified email claim. */
  email: string;
}

export interface OperatorMeta {
  actor: OperatorActor;
  requestId: string;
  idempotencyKey: string;
}

export interface OperatorCall<T> {
  input: T;
  meta: OperatorMeta;
}

/**
 * The envelope for an ANONYMOUS buyer, built once for every surface that takes
 * a guest checkout.
 *
 * ONE DEFINITION, because two would not stay identical and the cost of drift is
 * invisible. The subject is derived from the buyer's address — the only stable
 * thing they supply — and the idempotency key hangs off that subject, so the
 * derivation IS the dedup identity. Catalog and Console both accept checkouts;
 * had one of them changed the normalisation, a shopper double-clicking Buy on
 * that surface would stop replaying against the other, and the failure would
 * look like a duplicate order rather than a contract divergence.
 *
 * Lowercased and trimmed for the same reason `getCustomerOrder` compares that
 * way: an address is not case-sensitive in practice, and a retyped capital is
 * not a different person — nor a different cart.
 *
 * Under a real user IdP the subject becomes the session's, and the dedup
 * identity changes with it. That is a behavioural change, not a refactor.
 */
export const customerCall = <T>(email: string, commandId: string, input: T): OperatorCall<T> => {
  const sub = `customer:${email.trim().toLowerCase()}`;
  return {
    input,
    meta: {
      actor: { sub, email },
      requestId: commandId,
      idempotencyKey: deriveIdempotencyKey(sub, "placeOrder", commandId),
    },
  };
};

// ── Versioning ───────────────────────────────────────────────────────────────

/** Pure label arithmetic — see `core/versions.ts` for why it lives there. */
export { isValidVersion, nextVersion, type Bump } from "../core/versions.ts";

// ── Product DTOs ─────────────────────────────────────────────────────────────

/**
 * DERIVED FROM THE SCHEMA, not restated beside it.
 *
 * Every one of these was previously a hand-written twin of a `Schema` in
 * `Rpc.ts`, kept in step by hand across twelve types with no compile-time link
 * between them. Two had already drifted — `OrderDetailDTO.items` and
 * `DeletionImpact.warnings` declared mutable arrays where the schema yields
 * readonly ones — and drift surfaced as a runtime encode failure on a live
 * request rather than a build error.
 *
 * `import type` keeps this erased: no value crosses from the RPC boundary into
 * the domain vocabulary, only its shape.
 */
export type ProductStatus = typeof Rpc.ProductStatus.Type;
export type ProductDraftDTO = typeof Rpc.ProductDraft.Type;
export type ProductVariantDTO = typeof Rpc.ProductVariant.Type;
export type ProductMediaRole = typeof Rpc.MediaRole.Type;
export type ProductMediaDTO = typeof Rpc.ProductMedia.Type;

export type MediaMutationError =
  | "not_found"
  | "unsupported_type"
  | "invalid_size"
  | "invalid_role"
  | "storage_unavailable";

/** The public path a media id is served under. One spelling, used everywhere. */
export const mediaHref = (mediaId: string): string => `/media/${mediaId}`;

// ── Order DTOs ───────────────────────────────────────────────────────────────

export type OrderStatus = typeof Rpc.OrderStatus.Type;
export type ShippingAddress = typeof Rpc.ShippingAddress.Type;
export type OrderDetailDTO = typeof Rpc.OrderDetail.Type;
export type OrderListResult = typeof Rpc.OrderPage.Type;

export type OrderMutationError =
  | "not_found"
  | "invalid_transition"
  | "payment_incomplete"
  | "already_fulfilled";

// ── Deletion protocol ────────────────────────────────────────────────────────

export type DeletionImpact = typeof Rpc.DeletionImpact.Type;
export type DeletionPlan = typeof Rpc.DeletionPlan.Type;

/**
 * The confirm call's ONLY input. The target is recovered from the intent row, so
 * an operator holding a valid token cannot redirect it at a different aggregate.
 */
export interface ConfirmDeletionInput {
  confirmationToken: string;
}

/**
 * Unknown token, wrong operator, and wrong action all collapse to
 * `deletion_plan_mismatch` deliberately: splitting them for a better error
 * message would leak whether a token exists and who owns it.
 */
export type DeletionError =
  | "not_found"
  | "deletion_plan_expired"
  | "deletion_plan_mismatch"
  | "deletion_already_executed"
  | "deletion_plan_drift";

// ── Method inputs ────────────────────────────────────────────────────────────

export interface ListProductsInput {
  status?: ProductStatus | "all";
  limit?: number;
  cursor?: string;
}

export type ProductListPage = typeof Rpc.ProductPage.Type;
export type ProductDetail = typeof Rpc.ProductDetail.Type;

export interface CreateProductInput {
  slug: string;
  title: string;
  descriptionMarkdown?: string | null;
  priceCents: number;
}

export interface SaveProductDraftInput {
  productId: string;
  expectedRevision: number;
  title?: string;
  descriptionMarkdown?: string | null;
  priceCents?: number;
  slug?: string;
}

export interface PublishProductInput {
  productId: string;
  expectedRevision: number;
  /**
   * Optional. Omit it and the next one is derived — see {@link nextVersion}.
   * Supply it only when you actually want to name a release something specific.
   */
  version?: string;
  /** Which part of the derived label moves. Ignored when `version` is given. */
  bump?: Bump;
}

export interface PutVariantInput {
  productId: string;
  variantId?: string;
  size: string;
  sku: string;
  /**
   * Units this variant may still sell — shelf stock, or places in a pre-order
   * run. Which one it means is {@link mode}.
   */
  stock: number;
  mode?: "stock" | "preorder";
  /** When a pre-order buyer should expect it. Meaningless for `stock`. */
  expectedShipAt?: number | null;
}

export interface AdjustStockInput {
  variantId: string;
  delta: number;
  /** Free-text operator justification. Audit metadata, stored nowhere else. */
  reason: string;
}

export interface ReorderProductMediaInput {
  productId: string;
  mediaIds: string[];
}

export interface OrderListInput {
  status?: OrderStatus | "all";
  limit?: number;
  cursor?: string;
}

export interface SetOrderStatusInput {
  orderNumber: string;
  /** The only two statuses an operator may set directly. */
  status: "paid" | "cancelled";
}

export interface FulfillOrderInput {
  orderNumber: string;
  carrier: string;
  trackingNumber: string;
  note?: string;
}

export interface PlanProductReleaseDeletionInput {
  productId: string;
  releaseId: string;
  replacementReleaseId?: string | null;
}

/**
 * Media ingest. Unlike v2 this carries an `idempotencyKey`: v2's ingest was
 * off-contract with no key, so a retried upload created a duplicate image row.
 */
export interface IngestProductMediaInput {
  productId: string;
  bytes: ArrayBuffer;
  contentType: string;
  alt: string;
  role: ProductMediaRole;
}

// ── Storefront DTOs ──────────────────────────────────────────────────────────

/**
 * DERIVED FROM THE SCHEMA, like every other DTO here. These two were the
 * exception — hand-written twins of shapes that had no schema at all, because
 * the storefront reads were served as loose JSON rather than declared.
 */
export type ProductCardDTO = typeof StorefrontRpc.ProductCard.Type;
export type StorefrontProductDTO = typeof StorefrontRpc.StorefrontProduct.Type;
