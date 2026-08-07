/**
 * The plan/execute deletion protocol.
 *
 * WHY DELETION IS TWO CALLS. A hard delete in a Worker has no interactive
 * transaction and no undo, and the operator has to see a truthful blast radius
 * before committing. So `plan*` is a READ-ONLY impact derivation that mints a
 * capability, and `delete*` RE-DERIVES the impact from current data and refuses
 * if anything drifted. Neither call trusts the other's view of the world, and
 * the client is never trusted with the target at all.
 *
 * SUBJECT-IN-INTENT is the security property. The confirm call's only input is a
 * token; the target is recovered from the intent row, so an operator holding a
 * valid token cannot redirect it at a different aggregate.
 *
 * DRIFT DETECTION IS THE POINT. The retained ORDER counts are folded into the
 * impact hash, so a customer order arriving between plan and confirm invalidates
 * the plan rather than deleting under a stale preview. On a busy catalog a
 * delete may need several attempts; "plan invalidated by drift, re-plan" is a
 * normal flow, not an error.
 *
 * NO DELETION BATCH TOUCHES ORDER HISTORY. No statement below writes
 * `customer_order`, `order_item`, or the payment ledger. Order history is
 * byte-identical across a catalog delete — which is exactly what makes the
 * missing foreign key on `order_item.product_id` safe rather than sloppy.
 *
 * AN ASYMMETRY TO PRESERVE: `plan*` has no idempotency check and writes no audit
 * event — every plan mints a fresh token and intent row. Only the `delete*` side
 * is idempotency-guarded, which is how single-use tokens and safe retries
 * coexist: a retried call returns the recorded response and never reaches token
 * verification.
 */
import { and, count, countDistinct, eq, inArray, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { CoreOutcome } from "../services/Audit.ts";
import { Blobs } from "../services/Blobs.ts";
import { query, type ClassicDb, type DbStatement } from "../services/Database.ts";
import {
  err,
  ok,
  type DeletionError,
  type DeletionImpact,
  type DeletionPlan,
  type PlanProductReleaseDeletionInput,
  type ProductStatus,
} from "./Contracts.ts";
import {
  deletionIntent,
  orderItem,
  product,
  productAsset,
  productDraft,
  productImage,
  productRelease,
  productReleaseImage,
  productVariant,
} from "./Schema.ts";

/** A plan is short-lived on purpose: a stale preview is a dangerous preview. */
const DELETION_TTL_MS = 10 * 60 * 1000;

// ── Plan subjects ────────────────────────────────────────────────────────────

interface ReleaseSubject {
  readonly productId: string;
  readonly releaseId: string;
  readonly replacementReleaseId: string | null;
}
interface ProductSubject {
  readonly productId: string;
}
interface VariantSubject {
  readonly productId: string;
  readonly variantId: string;
}
interface MediaSubject {
  readonly productId: string;
  readonly mediaId: string;
}

type DeletionAction =
  | "deleteProductRelease"
  | "deleteProduct"
  | "deleteVariant"
  | "deleteProductMedia";

// ── Token and hash primitives ────────────────────────────────────────────────

const base64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const sha256Hex = Effect.fn("Deletion.sha256Hex")(function* (input: string) {
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
});

/** 32 cryptographically random bytes, base64url. Only its hash is ever stored. */
const newConfirmationToken = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
};

/**
 * Recursively key-sorted serialisation, so the impact hash is stable regardless
 * of property insertion order. The drift check compares hashes, not objects.
 */
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};

const impactHash = Effect.fn("Deletion.impactHash")(function* (impact: DeletionImpact) {
  return yield* sha256Hex(JSON.stringify(canonicalize(impact)));
});

// ── Impact derivation ────────────────────────────────────────────────────────

/**
 * How many distinct orders reference a set of variants. This is the RETAINED
 * count — those orders survive the delete untouched — and it is folded into the
 * impact hash so a new order between plan and confirm counts as drift.
 */
const ordersReferencingVariants = Effect.fn("Deletion.ordersReferencingVariants")(function* (
  db: ClassicDb,
  variantIds: readonly string[],
) {
  if (variantIds.length === 0) return 0;
  const rows = yield* query(() =>
    db
      .select({ total: countDistinct(orderItem.orderId) })
      .from(orderItem)
      .where(inArray(orderItem.variantId, [...variantIds])),
  );
  return rows[0]?.total ?? 0;
});

const ordersReferencingProduct = Effect.fn("Deletion.ordersReferencingProduct")(function* (
  db: ClassicDb,
  productId: string,
) {
  const rows = yield* query(() =>
    db
      .select({ total: countDistinct(orderItem.orderId) })
      .from(orderItem)
      .where(eq(orderItem.productId, productId)),
  );
  return rows[0]?.total ?? 0;
});

/** The release-deletion impact, or null when the release does not exist. */
const deriveReleaseImpact = Effect.fn("Deletion.deriveReleaseImpact")(function* (
  db: ClassicDb,
  subject: ReleaseSubject,
) {
  const releases = yield* query(() =>
    db
      .select({
        id: productRelease.id,
        version: productRelease.version,
        productId: productRelease.productId,
      })
      .from(productRelease)
      .where(
        and(
          eq(productRelease.id, subject.releaseId),
          eq(productRelease.productId, subject.productId),
        ),
      )
      .limit(1),
  );
  const release = releases[0];
  if (!release) return null;

  const owners = yield* query(() =>
    db
      .select({ activeReleaseId: product.activeReleaseId })
      .from(product)
      .where(eq(product.id, subject.productId))
      .limit(1),
  );
  const isActive = owners[0]?.activeReleaseId === subject.releaseId;

  const frozen = yield* query(() =>
    db
      .select({ total: count() })
      .from(productReleaseImage)
      .where(eq(productReleaseImage.releaseId, subject.releaseId)),
  );

  const retainedOrders = yield* ordersReferencingProduct(db, subject.productId);

  const warnings: string[] = [];
  if (isActive) {
    warnings.push(
      subject.replacementReleaseId
        ? "The active release will be replaced."
        : "The active release will be removed and the product pulled from sale.",
    );
  }
  if (retainedOrders > 0) {
    warnings.push(`${retainedOrders} order(s) reference this product and are unaffected.`);
  }

  const impact: DeletionImpact = {
    targetType: "product_release",
    targetId: subject.releaseId,
    label: `Release ${release.version}`,
    activeReleaseAffected: isActive,
    deleteCounts: { product_release: 1, product_release_image: frozen[0]?.total ?? 0 },
    retainedCounts: { customer_order: retainedOrders },
    warnings,
  };
  return { impact, isActive };
});

const deriveProductImpact = Effect.fn("Deletion.deriveProductImpact")(function* (
  db: ClassicDb,
  subject: ProductSubject,
) {
  const products = yield* query(() =>
    db
      .select({ id: product.id, slug: product.slug, activeReleaseId: product.activeReleaseId })
      .from(product)
      .where(eq(product.id, subject.productId))
      .limit(1),
  );
  const owner = products[0];
  if (!owner) return null;

  /**
   * FOUR SEQUENTIAL READS, and spelled as such. An array literal of `yield*`
   * reads as though the queries run together; a generator evaluates its
   * elements in order, so it never did. Naming them one per line stops the
   * shape from claiming a concurrency it does not have.
   */
  const releases = yield* query(() =>
    db
      .select({ total: count() })
      .from(productRelease)
      .where(eq(productRelease.productId, subject.productId)),
  );
  const variants = yield* query(() =>
    db
      .select({ total: count() })
      .from(productVariant)
      .where(eq(productVariant.productId, subject.productId)),
  );
  /**
   * ONE SWEEP FOR EVERY BYTE THIS PRODUCT OWNS — photographs and the size-guide
   * plate alike, because they are one table. This used to be two queries and
   * two key lists that both had to be remembered; forgetting the second orphaned
   * R2 objects, which is a leak you only notice on the storage bill.
   */
  const assets = yield* query(() =>
    db
      .select({ id: productAsset.id, storageKey: productAsset.storageKey })
      .from(productAsset)
      .where(eq(productAsset.productId, subject.productId)),
  );
  const retainedOrders = yield* ordersReferencingProduct(db, subject.productId);

  const warnings: string[] = ["The product, its draft, releases, variants and media all go."];
  if (owner.activeReleaseId) warnings.push("The active release will be removed.");
  if (retainedOrders > 0) {
    warnings.push(
      `${retainedOrders} order(s) reference this product. Order history is never modified — those lines keep their purchase-time snapshot.`,
    );
  }

  const impact: DeletionImpact = {
    targetType: "product",
    targetId: subject.productId,
    label: owner.slug,
    activeReleaseAffected: owner.activeReleaseId !== null,
    deleteCounts: {
      product: 1,
      product_draft: 1,
      product_release: releases[0]?.total ?? 0,
      product_variant: variants[0]?.total ?? 0,
      product_asset: assets.length,
    },
    retainedCounts: { customer_order: retainedOrders },
    warnings,
  };
  return { impact, storageKeys: assets.map((asset) => asset.storageKey) };
});

const deriveVariantImpact = Effect.fn("Deletion.deriveVariantImpact")(function* (
  db: ClassicDb,
  subject: VariantSubject,
) {
  const variants = yield* query(() =>
    db
      .select({ id: productVariant.id, size: productVariant.size, sku: productVariant.sku })
      .from(productVariant)
      .where(
        and(
          eq(productVariant.id, subject.variantId),
          eq(productVariant.productId, subject.productId),
        ),
      )
      .limit(1),
  );
  const variant = variants[0];
  if (!variant) return null;

  const retainedOrders = yield* ordersReferencingVariants(db, [subject.variantId]);
  const warnings: string[] = [];
  if (retainedOrders > 0) {
    warnings.push(`${retainedOrders} order(s) bought this size and are unaffected.`);
  }

  const impact: DeletionImpact = {
    targetType: "product_variant",
    targetId: subject.variantId,
    label: `${variant.size} (${variant.sku})`,
    activeReleaseAffected: false,
    deleteCounts: { product_variant: 1 },
    retainedCounts: { customer_order: retainedOrders },
    warnings,
  };
  return { impact };
});

const deriveMediaImpact = Effect.fn("Deletion.deriveMediaImpact")(function* (
  db: ClassicDb,
  subject: MediaSubject,
) {
  const images = yield* query(() =>
    db
      .select({
        id: productImage.assetId,
        alt: productImage.alt,
        storageKey: productAsset.storageKey,
      })
      .from(productImage)
      .innerJoin(productAsset, eq(productAsset.id, productImage.assetId))
      .where(
        and(
          eq(productImage.assetId, subject.mediaId),
          eq(productAsset.productId, subject.productId),
        ),
      )
      .limit(1),
  );
  const image = images[0];
  if (!image) return null;

  const frozen = yield* query(() =>
    db
      .select({ total: count() })
      .from(productReleaseImage)
      .where(eq(productReleaseImage.imageId, subject.mediaId)),
  );

  const remaining = yield* query(() =>
    db
      .select({ total: count() })
      .from(productImage)
      .innerJoin(productAsset, eq(productAsset.id, productImage.assetId))
      .where(eq(productAsset.productId, subject.productId)),
  );
  const lastImage = (remaining[0]?.total ?? 0) <= 1;

  const warnings: string[] = [];
  if ((frozen[0]?.total ?? 0) > 0) {
    warnings.push(
      `This image is frozen into ${frozen[0]?.total} published release(s); those snapshots lose it too.`,
    );
  }
  if (lastImage) {
    warnings.push("This is the product's last image, so it can no longer be published.");
  }

  const impact: DeletionImpact = {
    targetType: "media",
    targetId: subject.mediaId,
    label: image.alt || subject.mediaId,
    activeReleaseAffected: (frozen[0]?.total ?? 0) > 0,
    deleteCounts: { product_asset: 1, product_release_image: frozen[0]?.total ?? 0 },
    retainedCounts: {},
    warnings,
  };
  return { impact, storageKey: image.storageKey, lastImage };
});

// ── Intent minting ───────────────────────────────────────────────────────────

/**
 * Mint a plan: hash the impact, store the intent under the token's hash, and
 * return the plaintext token exactly once. The token is a CAPABILITY — holding
 * it is the entire authorisation to execute this specific delete.
 */
const mintPlan = Effect.fn("Deletion.mintPlan")(function* (
  db: ClassicDb,
  action: DeletionAction,
  operatorSub: string,
  subject: unknown,
  impact: DeletionImpact,
  now: number,
) {
  const token = newConfirmationToken();
  const tokenHash = yield* sha256Hex(token);
  const hash = yield* impactHash(impact);
  const expiresAt = now + DELETION_TTL_MS;

  const statement = db.insert(deletionIntent).values({
    tokenHash,
    operatorSub,
    action,
    targetId: JSON.stringify(subject),
    impactHash: hash,
    expiresAt,
    consumedAt: null,
  }) as unknown as DbStatement;

  const plan: DeletionPlan = { impact, confirmationToken: token, expiresAt };
  return { statement, plan };
});

/**
 * Resolve a token into its intent, or a typed reason it cannot be used.
 *
 * Unknown token, wrong operator and wrong action all collapse to
 * `deletion_plan_mismatch` deliberately: distinguishing them would leak whether
 * a token exists and who owns it.
 */
/** Either a typed refusal, or the intent with its subject decoded. */
type ResolvedIntent<S> =
  | { readonly error: DeletionError }
  | { readonly tokenHash: string; readonly impactHash: string; readonly subject: S };

const resolveIntent = Effect.fn("Deletion.resolveIntent")(function* <S>(
  db: ClassicDb,
  token: string,
  action: DeletionAction,
  operatorSub: string,
  now: number,
): Effect.fn.Return<ResolvedIntent<S>> {
  const tokenHash = yield* sha256Hex(token);
  const rows = yield* query(() =>
    db.select().from(deletionIntent).where(eq(deletionIntent.tokenHash, tokenHash)).limit(1),
  );
  const intent = rows[0];
  if (!intent) return { error: "deletion_plan_mismatch" as const };
  if (intent.operatorSub !== operatorSub || intent.action !== action) {
    return { error: "deletion_plan_mismatch" as const };
  }
  if (intent.consumedAt !== null) return { error: "deletion_already_executed" as const };
  if (intent.expiresAt < now) return { error: "deletion_plan_expired" as const };

  return {
    tokenHash,
    impactHash: intent.impactHash,
    subject: JSON.parse(intent.targetId) as S,
  };
});

/** Mark the intent consumed. Goes in the SAME batch as the delete, so it is atomic. */
const consumeStatement = (db: ClassicDb, tokenHash: string, now: number): DbStatement =>
  db
    .update(deletionIntent)
    .set({ consumedAt: now })
    .where(
      and(eq(deletionIntent.tokenHash, tokenHash), isNull(deletionIntent.consumedAt)),
    ) as unknown as DbStatement;

// ── plan* ────────────────────────────────────────────────────────────────────

export const planProductReleaseDeletion = Effect.fn("Deletion.planProductReleaseDeletion")(
  function* (
    db: ClassicDb,
    input: PlanProductReleaseDeletionInput,
    operatorSub: string,
    now: number,
  ): Effect.fn.Return<CoreOutcome<DeletionPlan, "not_found" | "invalid_replacement">> {
    const subject: ReleaseSubject = {
      productId: input.productId,
      releaseId: input.releaseId,
      replacementReleaseId: input.replacementReleaseId ?? null,
    };

    const derived = yield* deriveReleaseImpact(db, subject);
    if (!derived) return { failure: err("not_found") };

    /**
     * A replacement must be a DIFFERENT release of the SAME product. Without
     * this, a typo could point a product's active release at another product's
     * snapshot and silently change what is on sale.
     */
    if (subject.replacementReleaseId) {
      if (subject.replacementReleaseId === subject.releaseId) {
        return { failure: err("invalid_replacement") };
      }
      const candidates = yield* query(() =>
        db
          .select({ id: productRelease.id })
          .from(productRelease)
          .where(
            and(
              eq(productRelease.id, subject.replacementReleaseId as string),
              eq(productRelease.productId, subject.productId),
            ),
          )
          .limit(1),
      );
      if (!candidates[0]) return { failure: err("invalid_replacement") };
    }

    const { statement, plan } = yield* mintPlan(
      db,
      "deleteProductRelease",
      operatorSub,
      subject,
      derived.impact,
      now,
    );
    return {
      statements: [statement],
      response: ok(plan),
      facts: { targetType: "product_release", targetId: input.releaseId },
    };
  },
);

export const planProductDeletion = Effect.fn("Deletion.planProductDeletion")(function* (
  db: ClassicDb,
  productId: string,
  operatorSub: string,
  now: number,
): Effect.fn.Return<CoreOutcome<DeletionPlan, "not_found">> {
  const derived = yield* deriveProductImpact(db, { productId });
  if (!derived) return { failure: err("not_found") };

  const { statement, plan } = yield* mintPlan(
    db,
    "deleteProduct",
    operatorSub,
    { productId },
    derived.impact,
    now,
  );
  return {
    statements: [statement],
    response: ok(plan),
    facts: { targetType: "product", targetId: productId },
  };
});

export const planVariantDeletion = Effect.fn("Deletion.planVariantDeletion")(function* (
  db: ClassicDb,
  subject: VariantSubject,
  operatorSub: string,
  now: number,
): Effect.fn.Return<CoreOutcome<DeletionPlan, "not_found">> {
  const derived = yield* deriveVariantImpact(db, subject);
  if (!derived) return { failure: err("not_found") };

  const { statement, plan } = yield* mintPlan(
    db,
    "deleteVariant",
    operatorSub,
    subject,
    derived.impact,
    now,
  );
  return {
    statements: [statement],
    response: ok(plan),
    facts: { targetType: "variant", targetId: subject.variantId },
  };
});

export const planProductMediaDeletion = Effect.fn("Deletion.planProductMediaDeletion")(function* (
  db: ClassicDb,
  subject: MediaSubject,
  operatorSub: string,
  now: number,
): Effect.fn.Return<CoreOutcome<DeletionPlan, "not_found">> {
  const derived = yield* deriveMediaImpact(db, subject);
  if (!derived) return { failure: err("not_found") };

  const { statement, plan } = yield* mintPlan(
    db,
    "deleteProductMedia",
    operatorSub,
    subject,
    derived.impact,
    now,
  );
  return {
    statements: [statement],
    response: ok(plan),
    facts: { targetType: "media", targetId: subject.mediaId },
  };
});

// ── delete* ──────────────────────────────────────────────────────────────────

/** Re-derive, compare hashes, and refuse on drift. Shared by all four. */
const checkDrift = Effect.fn("Deletion.checkDrift")(function* (
  expected: string,
  impact: DeletionImpact,
) {
  const actual = yield* impactHash(impact);
  return actual === expected;
});

export const deleteProductRelease = Effect.fn("Deletion.deleteProductRelease")(function* (
  db: ClassicDb,
  token: string,
  operatorSub: string,
  now: number,
): Effect.fn.Return<CoreOutcome<{ deleted: true; activeVersion: string | null }, DeletionError>> {
  const resolved = yield* resolveIntent<ReleaseSubject>(
    db,
    token,
    "deleteProductRelease",
    operatorSub,
    now,
  );
  if ("error" in resolved) return { failure: err(resolved.error) };

  const derived = yield* deriveReleaseImpact(db, resolved.subject);
  if (!derived) return { failure: err("not_found") };
  if (!(yield* checkDrift(resolved.impactHash, derived.impact))) {
    return { failure: err("deletion_plan_drift") };
  }

  const { productId, releaseId, replacementReleaseId } = resolved.subject;

  /**
   * NO SIZE-GUIDE STATEMENT HERE, and the omission is deliberate rather than
   * missed. Deleting a release drops its REFERENCE to a plate; the plate row
   * and its bytes stay, because the draft or another release may still name
   * them, and the one thing this schema will not do is let a chart vanish out
   * of published content. When neither does, what is left behind is one small
   * row and one R2 object nothing can reach — the same benign leak the rest of
   * this path accepts, and strictly the safer side of the trade. A product
   * delete does collect them: see `deriveProductImpact`.
   */

  /**
   * If the deleted release was live, the product either moves to the
   * replacement or is pulled from sale. It is NEVER left pointing at a deleted
   * release — `unavailable` is the honest state for a product with no live
   * snapshot.
   */
  const productPatch = derived.isActive
    ? replacementReleaseId
      ? { activeReleaseId: replacementReleaseId, updatedAt: now }
      : { activeReleaseId: null, status: "unavailable" as ProductStatus, updatedAt: now }
    : { updatedAt: now };

  let activeVersion: string | null = null;
  if (derived.isActive && replacementReleaseId) {
    const rows = yield* query(() =>
      db
        .select({ version: productRelease.version })
        .from(productRelease)
        .where(eq(productRelease.id, replacementReleaseId))
        .limit(1),
    );
    activeVersion = rows[0]?.version ?? null;
  }

  return {
    statements: [
      // Point the product away from the release BEFORE deleting it, so the
      // circular FK never dangles mid-batch.
      db
        .update(product)
        .set(productPatch)
        .where(eq(product.id, productId)) as unknown as DbStatement,
      db
        .delete(productReleaseImage)
        .where(eq(productReleaseImage.releaseId, releaseId)) as unknown as DbStatement,
      db.delete(productRelease).where(eq(productRelease.id, releaseId)) as unknown as DbStatement,
      consumeStatement(db, resolved.tokenHash, now),
    ],
    response: ok({ deleted: true as const, activeVersion }),
    facts: {
      targetType: "product_release",
      targetId: releaseId,
      detail: { wasActive: derived.isActive },
    },
  };
});

export const deleteProduct = Effect.fn("Deletion.deleteProduct")(function* (
  db: ClassicDb,
  token: string,
  operatorSub: string,
  now: number,
  // `Blobs` in the requirement channel: the bytes are dropped after the batch
  // commits, so the capability has to survive into `onCommitted`.
): Effect.fn.Return<CoreOutcome<{ deleted: true }, DeletionError>, never, Blobs> {
  const resolved = yield* resolveIntent<ProductSubject>(
    db,
    token,
    "deleteProduct",
    operatorSub,
    now,
  );
  if ("error" in resolved) return { failure: err(resolved.error) };

  const derived = yield* deriveProductImpact(db, resolved.subject);
  if (!derived) return { failure: err("not_found") };
  if (!(yield* checkDrift(resolved.impactHash, derived.impact))) {
    return { failure: err("deletion_plan_drift") };
  }

  const { productId } = resolved.subject;
  const blobs = yield* Blobs;

  /**
   * Explicit statements in dependency order rather than relying on cascades:
   * the order IS the specification, and a reader should not have to reconstruct
   * it from foreign-key definitions. Note that `order_item` is absent — order
   * history is untouched, which is the whole point.
   */
  return {
    statements: [
      db
        .update(product)
        .set({ activeReleaseId: null })
        .where(eq(product.id, productId)) as unknown as DbStatement,
      db
        .delete(productReleaseImage)
        .where(
          inArray(
            productReleaseImage.releaseId,
            db
              .select({ id: productRelease.id })
              .from(productRelease)
              .where(eq(productRelease.productId, productId)),
          ),
        ) as unknown as DbStatement,
      db
        .delete(productRelease)
        .where(eq(productRelease.productId, productId)) as unknown as DbStatement,
      /**
       * ONE STATEMENT FOR EVERY BYTE, and it must come AFTER the releases.
       * `product_release.size_guide_asset_id` is `RESTRICT` — its whole job is
       * refusing to let a plate vanish out of published content — so an asset
       * deleted while any release still named it would abort this batch on a
       * constraint violation and surface as a 500. The releases are gone by the
       * time this runs, so nothing names it. `product_image` cascades from
       * here, which is why it needs no statement of its own.
       */
      db
        .delete(productAsset)
        .where(eq(productAsset.productId, productId)) as unknown as DbStatement,
      db
        .delete(productVariant)
        .where(eq(productVariant.productId, productId)) as unknown as DbStatement,
      db
        .delete(productDraft)
        .where(eq(productDraft.productId, productId)) as unknown as DbStatement,
      db.delete(product).where(eq(product.id, productId)) as unknown as DbStatement,
      consumeStatement(db, resolved.tokenHash, now),
    ],
    response: ok({ deleted: true as const }),
    facts: {
      targetType: "product",
      targetId: productId,
      detail: { imageCount: derived.storageKeys.length },
    },
    onCommitted: blobs.delete(derived.storageKeys),
  };
});

export const deleteVariant = Effect.fn("Deletion.deleteVariant")(function* (
  db: ClassicDb,
  token: string,
  operatorSub: string,
  now: number,
): Effect.fn.Return<CoreOutcome<{ deleted: true }, DeletionError>> {
  const resolved = yield* resolveIntent<VariantSubject>(
    db,
    token,
    "deleteVariant",
    operatorSub,
    now,
  );
  if ("error" in resolved) return { failure: err(resolved.error) };

  const derived = yield* deriveVariantImpact(db, resolved.subject);
  if (!derived) return { failure: err("not_found") };
  if (!(yield* checkDrift(resolved.impactHash, derived.impact))) {
    return { failure: err("deletion_plan_drift") };
  }

  return {
    statements: [
      db
        .delete(productVariant)
        .where(eq(productVariant.id, resolved.subject.variantId)) as unknown as DbStatement,
      db
        .update(product)
        .set({ updatedAt: now })
        .where(eq(product.id, resolved.subject.productId)) as unknown as DbStatement,
      consumeStatement(db, resolved.tokenHash, now),
    ],
    response: ok({ deleted: true as const }),
    facts: { targetType: "variant", targetId: resolved.subject.variantId },
  };
});

export const deleteProductMedia = Effect.fn("Deletion.deleteProductMedia")(function* (
  db: ClassicDb,
  token: string,
  operatorSub: string,
  now: number,
): Effect.fn.Return<
  CoreOutcome<{ deleted: true; productStatus: ProductStatus }, DeletionError>,
  never,
  Blobs
> {
  const resolved = yield* resolveIntent<MediaSubject>(
    db,
    token,
    "deleteProductMedia",
    operatorSub,
    now,
  );
  if ("error" in resolved) return { failure: err(resolved.error) };

  const derived = yield* deriveMediaImpact(db, resolved.subject);
  if (!derived) return { failure: err("not_found") };
  if (!(yield* checkDrift(resolved.impactHash, derived.impact))) {
    return { failure: err("deletion_plan_drift") };
  }

  const owners = yield* query(() =>
    db
      .select({ status: product.status })
      .from(product)
      .where(eq(product.id, resolved.subject.productId))
      .limit(1),
  );
  const productStatus = (owners[0]?.status ?? "draft") as ProductStatus;
  const blobs = yield* Blobs;

  return {
    statements: [
      db
        .delete(productReleaseImage)
        .where(eq(productReleaseImage.imageId, resolved.subject.mediaId)) as unknown as DbStatement,
      /** The asset IS the image; its `product_image` row cascades away with it. */
      db
        .delete(productAsset)
        .where(eq(productAsset.id, resolved.subject.mediaId)) as unknown as DbStatement,
      db
        .update(product)
        .set({ updatedAt: now })
        .where(eq(product.id, resolved.subject.productId)) as unknown as DbStatement,
      consumeStatement(db, resolved.tokenHash, now),
    ],
    response: ok({ deleted: true as const, productStatus }),
    facts: {
      targetType: "media",
      targetId: resolved.subject.mediaId,
      detail: { lastImage: derived.lastImage },
    },
    onCommitted: blobs.delete([derived.storageKey]),
  };
});
