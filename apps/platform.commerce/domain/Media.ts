/**
 * Product media ingest.
 *
 * Two things differ from v2, both deliberate.
 *
 * IT IS ON THE CONTRACT. v2 kept `ingestProductMedia` off its frozen surface
 * because it carried bytes rather than a domain DTO — and the consequence was
 * that it had no idempotency key and wrote no audit event, so a retried upload
 * created a duplicate image row. Carrying bytes is not a reason to lose
 * idempotency; it is a reason to take the key explicitly, which the input does.
 *
 * THE BYTES GO TO R2 BEFORE THE ROW IS WRITTEN. That ordering makes a row that
 * exists servable by construction, which is why there is no `state` column and
 * no pending → ready → failed lifecycle. If the put succeeds and the commit
 * fails, an unreferenced object is left behind — the same benign leak the
 * deletion path accepts, and far better than a row pointing at nothing.
 */
import { and, count, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { CoreOutcome } from "../services/Audit.ts";
import { Blobs, productMediaKey } from "../services/Blobs.ts";
import { query, type ClassicDb, type DbStatement } from "../services/Database.ts";
import {
  err,
  mediaHref,
  ok,
  type IngestProductMediaInput,
  type MediaMutationError,
  type ProductMediaDTO,
} from "./Contracts.ts";
import { product, productImage } from "./Schema.ts";

/** What the storefront and the operator console can actually display. */
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

/** 10 MB. Large enough for a product photograph, small enough to bound a Worker's memory. */
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

const sha256Hex = Effect.fn("Media.sha256Hex")(function* (bytes: ArrayBuffer) {
  const digest = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
});

export const ingestProductMedia = Effect.fn("Media.ingestProductMedia")(function* (
  db: ClassicDb,
  input: IngestProductMediaInput,
  now: number,
  imageId: string,
): Effect.fn.Return<CoreOutcome<ProductMediaDTO, MediaMutationError>, never, Blobs> {
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    return { failure: err("unsupported_type", input.contentType) };
  }
  const size = input.bytes.byteLength;
  if (size === 0 || size > MAX_MEDIA_BYTES) {
    return { failure: err("invalid_size", `${size} bytes`) };
  }

  const owners = yield* query(() =>
    db
      .select({ total: count() })
      .from(productImage)
      .where(eq(productImage.productId, input.productId)),
  );
  // Appended at the end; `reorderProductMedia` is the only way to change order.
  const position = owners[0]?.total ?? 0;

  const blobs = yield* Blobs;
  const storageKey = productMediaKey(input.productId, imageId);
  const sha256 = yield* sha256Hex(input.bytes);

  /**
   * Written BEFORE the row. A failure here is a domain condition rather than a
   * defect — object storage being unavailable is an operational state the
   * operator console should render, not a crash.
   */
  const stored = yield* blobs.put(storageKey, input.bytes, input.contentType).pipe(
    Effect.map(() => null),
    Effect.catchTag("BlobFailed", (error) =>
      Effect.succeed({ failure: err("storage_unavailable", error.message) } as const),
    ),
  );
  if (stored !== null) return stored;

  const dto: ProductMediaDTO = {
    id: imageId,
    productId: input.productId,
    alt: input.alt,
    role: input.role,
    position,
    href: mediaHref(imageId),
    contentType: input.contentType,
    size,
    sha256,
  };

  return {
    statements: [
      db.insert(productImage).values({
        id: imageId,
        productId: input.productId,
        storageKey,
        contentSha256: sha256,
        contentType: input.contentType,
        sizeBytes: size,
        alt: input.alt,
        role: input.role,
        position,
        createdAt: now,
      }) as unknown as DbStatement,
    ],
    response: ok(dto),
    facts: {
      targetType: "media",
      targetId: imageId,
      detail: { productId: input.productId, size, role: input.role },
    },
  };
});

/**
 * Resolve a media id to its bytes, for the public `/media/:id` route.
 *
 * GATED ON THE PRODUCT BEING ACTIVE, joined rather than checked afterwards.
 * `unavailable` is a published product PULLED FROM SALE — the whole reason the
 * status domain has four values — and the listing and product page both honour
 * it. Serving the image regardless meant a link anyone already had kept working
 * after the product was withdrawn, which is the one thing withdrawing it was
 * supposed to stop.
 *
 * INNER JOIN, so a missing or non-active product yields no row and the route
 * 404s. Fail-closed, matching `Storefront.listActiveProducts`.
 */
export const openMedia = Effect.fn("Media.openMedia")(function* (db: ClassicDb, mediaId: string) {
  const rows = yield* query(() =>
    db
      .select({ storageKey: productImage.storageKey, contentType: productImage.contentType })
      .from(productImage)
      .innerJoin(product, eq(product.id, productImage.productId))
      .where(and(eq(productImage.id, mediaId), eq(product.status, "active")))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;

  const blobs = yield* Blobs;
  const object = yield* Effect.result(blobs.get(row.storageKey));
  if (object._tag === "Failure" || object.success === null) return null;
  return object.success;
});
