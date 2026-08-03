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
  type ProductMediaRole,
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

/**
 * The same bytes, WITHOUT the status gate — for the operator console alone.
 *
 * WHY IT HAS TO EXIST. `publishProduct` refuses with `missing_media` until a
 * product has a cover, and `openMedia` above serves nothing until the product
 * is `active` — which it cannot become before it is published. So the one
 * moment an operator most needs to see a photograph is precisely the window in
 * which the public route is guaranteed to 404. Without this the console
 * uploads blind and the first look at a product image is on the live
 * storefront, which is not a workflow anyone should sell from.
 *
 * WHY IT IS SAFE. It is reachable only through `CommerceSurface`, which is
 * reachable only over a service binding — `workers/Commerce.ts` sets
 * `workersDev: false` and claims no domain, so nothing addresses it. The
 * public `/media/:id` route is served by `workers/Media.ts` and calls
 * {@link openMedia}, which is unchanged and still fail-closed. Withdrawing a
 * product still kills every image link anyone already had.
 *
 * STREAMED, exactly like {@link openMedia} — the R2 body is handed on
 * untouched and nothing is read into the isolate. The two differ in their
 * WHERE clause and in nothing else.
 */
export const openOperatorMedia = Effect.fn("Media.openOperatorMedia")(function* (
  db: ClassicDb,
  mediaId: string,
) {
  const rows = yield* query(() =>
    db
      .select({ storageKey: productImage.storageKey })
      .from(productImage)
      .where(eq(productImage.id, mediaId))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;

  const blobs = yield* Blobs;
  const object = yield* Effect.result(blobs.get(row.storageKey));
  if (object._tag === "Failure" || object.success === null) return null;
  return object.success;
});

/**
 * The content type behind a media id, without opening the object.
 *
 * A SEPARATE CALL rather than a field beside the bytes, because the RPC bridge
 * unwraps a stream envelope only at the TOP LEVEL of a result — a
 * `{ body, contentType }` struct carrying a live `ReadableStream` does not
 * survive the hop, and the alternative to two calls is buffering the image to
 * put it in one. A D1 row read is the cheaper half of that trade.
 *
 * Same absence of a status gate, for the same reason, with the same
 * binding-only reachability making it safe.
 */
export const operatorMediaContentType = Effect.fn("Media.operatorMediaContentType")(function* (
  db: ClassicDb,
  mediaId: string,
) {
  const rows = yield* query(() =>
    db
      .select({ contentType: productImage.contentType })
      .from(productImage)
      .where(eq(productImage.id, mediaId))
      .limit(1),
  );
  return rows[0]?.contentType ?? null;
});

/**
 * WHICH IMAGE IS THE COVER, decided after looking at them.
 *
 * `ingestProductMedia` takes a role at upload, and until now that was the only
 * time it could be set — so an operator who uploaded three photographs and then
 * decided which one should lead had to delete and re-upload. The cover is what
 * a listing shows, so that is not a cosmetic gap.
 *
 * Scoped by BOTH ids. `mediaId` alone would let a caller re-role an image
 * belonging to another product by guessing an id; requiring the pair means the
 * caller must already know what they are editing.
 *
 * No uniqueness rule on `cover`. Several covers is a display question the
 * storefront answers by taking the first, and enforcing one here would mean a
 * second write to demote the incumbent — two statements that can disagree, to
 * prevent something harmless.
 */
export const setProductMediaRole = Effect.fn("Media.setProductMediaRole")(function* (
  db: ClassicDb,
  input: { productId: string; mediaId: string; role: ProductMediaRole },
  now: number,
): Effect.fn.Return<CoreOutcome<{ mediaId: string; role: ProductMediaRole }, MediaMutationError>> {
  const rows = yield* query(() =>
    db
      .select({ id: productImage.id })
      .from(productImage)
      .where(and(eq(productImage.id, input.mediaId), eq(productImage.productId, input.productId)))
      .limit(1),
  );
  if (!rows[0]) return { failure: err("not_found") };

  return {
    statements: [
      db
        .update(productImage)
        .set({ role: input.role })
        .where(eq(productImage.id, input.mediaId)) as unknown as DbStatement,
      db
        .update(product)
        .set({ updatedAt: now })
        .where(eq(product.id, input.productId)) as unknown as DbStatement,
    ],
    response: ok({ mediaId: input.mediaId, role: input.role }),
    facts: {
      targetType: "media",
      targetId: input.mediaId,
      detail: { productId: input.productId, role: input.role },
    },
  };
});
