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
import { and, eq, sql } from "drizzle-orm";
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
  type PutProductSizeGuideInput,
} from "./Contracts.ts";
import { product, productAsset, productDraft, productImage, productRelease } from "./Schema.ts";

/**
 * What the storefront and the operator console can actually display.
 *
 * ONE ALLOWLIST FOR EVERY IMAGE THIS STORE HOLDS — product photography and the
 * size-guide plate alike. The plate briefly had a narrower one of its own,
 * PNG-only, on the reasoning that it is composited over a background and so
 * "needs" an alpha channel. That was a rendering preference dressed up as a
 * validation rule: an opaque chart is a perfectly good chart, `object-fit:
 * contain` handles either, and an operator who wants to use a WebP they already
 * have is not making a mistake. The only thing a store may legitimately refuse
 * is a format a browser will not render.
 */
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

  /**
   * APPENDED AT THE END, and it is `max(position) + 1` rather than a COUNT.
   *
   * A count is only the next free position while the sequence is dense from
   * zero, and nothing guarantees that — positions are not unique and a deleted
   * image leaves a gap behind it. Counting after a delete therefore hands the
   * new image a position an existing one already holds, and the newcomer lands
   * in the middle of the strip instead of at its end. `reorderProductMedia`
   * remains the only way to change the order deliberately.
   */
  const owners = yield* query(() =>
    db
      .select({ highest: sql<number | null>`max(${productImage.position})` })
      .from(productImage)
      .innerJoin(productAsset, eq(productAsset.id, productImage.assetId))
      .where(eq(productAsset.productId, input.productId)),
  );
  const highest = owners[0]?.highest;
  const position = highest === null || highest === undefined ? 0 : highest + 1;

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
    position,
    href: mediaHref(imageId),
    contentType: input.contentType,
    size,
    sha256,
  };

  return {
    /**
     * THE BYTES, THEN THE USE. An asset row is the media identity; the
     * `product_image` row beside it is what makes this asset ordered product
     * photography rather than, say, the size-guide plate. Same batch, so an
     * asset with no use is unrepresentable.
     */
    statements: [
      db.insert(productAsset).values({
        id: imageId,
        productId: input.productId,
        storageKey,
        contentSha256: sha256,
        contentType: input.contentType,
        sizeBytes: size,
        createdAt: now,
      }) as unknown as DbStatement,
      db.insert(productImage).values({
        assetId: imageId,
        alt: input.alt,
        position,
      }) as unknown as DbStatement,
    ],
    response: ok(dto),
    facts: {
      targetType: "media",
      targetId: imageId,
      detail: { productId: input.productId, size, position },
    },
  };
});

/**
 * WHAT A MEDIA ID NAMES — one indexed lookup, because there is one table.
 *
 * `/media/<id>` names a `product_asset` row and nothing else. Whether that
 * asset is ordered product photography or the size-guide plate is a question
 * about who REFERENCES it, and this route does not care: it wants the bytes and
 * the type to serve them with.
 *
 * This is what the byte/use split bought. While the plate had a table of its
 * own, three call sites hand-wrote the same "try `product_image`, else
 * `product_size_guide`" probe, and the public route — unauthenticated, and the
 * highest-volume path in this app — paid two round trips on every MISS. Misses
 * are the common case out here: a bad id, a stale link, a withdrawn product,
 * all answered by `workers/Media.ts` with a 404 that carries no
 * `cache-control` and so is never absorbed by a CDN.
 *
 * `requireActive` is that route's fail-closed gate. `unavailable` is a
 * published product PULLED FROM SALE — the whole reason the status domain has
 * four values — so a withdrawn product's chart stops being served at the same
 * instant its photographs do. The console passes `false`, because a draft is by
 * definition not active and that window is precisely when an operator most
 * needs to see what they just uploaded.
 */
const resolveMediaObject = Effect.fn("Media.resolveMediaObject")(function* (
  db: ClassicDb,
  mediaId: string,
  requireActive: boolean,
) {
  const rows = yield* query(() =>
    db
      .select({ storageKey: productAsset.storageKey, contentType: productAsset.contentType })
      .from(productAsset)
      .innerJoin(product, eq(product.id, productAsset.productId))
      .where(
        requireActive
          ? and(eq(productAsset.id, mediaId), eq(product.status, "active"))
          : eq(productAsset.id, mediaId),
      )
      .limit(1),
  );
  return rows[0] ?? null;
});

/**
 * Resolve a media id to its bytes, for the public `/media/:id` route.
 *
 * GATED ON THE PRODUCT BEING ACTIVE, joined rather than checked afterwards.
 * Serving the image regardless meant a link anyone already had kept working
 * after the product was withdrawn, which is the one thing withdrawing it was
 * supposed to stop. Fail-closed, matching `Storefront.listActiveProducts`.
 */
export const openMedia = Effect.fn("Media.openMedia")(function* (db: ClassicDb, mediaId: string) {
  const row = yield* resolveMediaObject(db, mediaId, true);
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
  const row = yield* resolveMediaObject(db, mediaId, false);
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
  return (yield* resolveMediaObject(db, mediaId, false))?.contentType ?? null;
});

// ── The size-guide plate ─────────────────────────────────────────────────────

/**
 * RETIRE THE PLATE A DRAFT IS LETTING GO OF — the retain rule, in one place,
 * because replace and remove make exactly the same decision about it.
 *
 * If no published release names the outgoing plate it is deleted outright, row
 * and bytes, because an orphan chart nobody can reach is pure cost. If a
 * release DOES name it, both stay exactly where they are and only the draft's
 * reference moves — a published product page keeps rendering the chart it was
 * published with. `retained` is returned rather than hidden so the console can
 * say which of the two happened.
 *
 * ONE QUERY, not two. The count and the storage key are facts about the same
 * row; asking for them separately was two D1 round trips on an operator action
 * that has already paid for an R2 upload. A correlated subquery gets both.
 *
 * `ne(releaseId, ...)` has no place in that count: every release counts,
 * including the active one, because "still on a live product page" is the
 * strongest form of "still in use".
 */
const retirePlate = Effect.fn("Media.retirePlate")(function* (
  db: ClassicDb,
  plateId: string | null,
) {
  if (plateId === null)
    return { retained: 0, statements: [] as DbStatement[], keys: [] as string[] };

  const rows = yield* query(() =>
    db
      .select({
        storageKey: productAsset.storageKey,
        retained: sql<number>`(select count(*) from ${productRelease} where ${productRelease.sizeGuideAssetId} = ${plateId})`,
      })
      .from(productAsset)
      .where(eq(productAsset.id, plateId))
      .limit(1),
  );
  const row = rows[0];
  const retained = row?.retained ?? 0;
  if (!row || retained > 0)
    return { retained, statements: [] as DbStatement[], keys: [] as string[] };

  return {
    retained,
    statements: [
      db.delete(productAsset).where(eq(productAsset.id, plateId)) as unknown as DbStatement,
    ],
    keys: [row.storageKey],
  };
});

/**
 * UPLOAD OR REPLACE the size-guide plate. One per product, so this is an upsert
 * of a reference rather than an append to a list.
 *
 * WHAT HAPPENS TO THE OUTGOING PLATE is the whole of this function's care. If
 * no release names it, it is deleted outright — row and bytes — because an
 * orphan chart nobody can reach is pure cost. If a release DOES name it, the
 * row and the bytes stay exactly where they are and only the draft's reference
 * moves. A published product page keeps rendering the chart it was published
 * with, which is the point: replacing a draft asset is an edit to the draft,
 * and an edit to the draft has never been allowed to reach a release.
 *
 * NOT REVISION-GUARDED, deliberately, and it is the same call the console makes
 * from a file picker. It writes exactly one draft column — the reference — and
 * touches no copy, so there is nothing for a concurrent `saveProductDraft` to
 * lose. Making it take `expectedRevision` would mean a dropped upload every
 * time an operator typed in the description field first.
 */
export const putProductSizeGuide = Effect.fn("Media.putProductSizeGuide")(function* (
  db: ClassicDb,
  input: PutProductSizeGuideInput,
  now: number,
  sizeGuideId: string,
): Effect.fn.Return<
  CoreOutcome<{ sizeGuideAssetId: string; href: string }, MediaMutationError>,
  never,
  Blobs
> {
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    return { failure: err("unsupported_type", input.contentType) };
  }
  const size = input.bytes.byteLength;
  if (size === 0 || size > MAX_MEDIA_BYTES) {
    return { failure: err("invalid_size", `${size} bytes`) };
  }

  const drafts = yield* query(() =>
    db
      .select({ current: productDraft.sizeGuideAssetId })
      .from(productDraft)
      .where(eq(productDraft.productId, input.productId))
      .limit(1),
  );
  const draft = drafts[0];
  if (!draft) return { failure: err("not_found") };

  const blobs = yield* Blobs;
  const storageKey = productMediaKey(input.productId, sizeGuideId);
  const sha256 = yield* sha256Hex(input.bytes);

  /** Bytes before row, exactly as for product photography — see the file header. */
  const stored = yield* blobs.put(storageKey, input.bytes, input.contentType).pipe(
    Effect.map(() => null),
    Effect.catchTag("BlobFailed", (error) =>
      Effect.succeed({ failure: err("storage_unavailable", error.message) } as const),
    ),
  );
  if (stored !== null) return stored;

  const outgoing = yield* retirePlate(db, draft.current);

  return {
    statements: [
      /**
       * AN ASSET WITH NO `product_image` ROW BESIDE IT — which is exactly what
       * makes it the plate rather than a photograph. The use is the draft's
       * reference below, not a kind column here.
       */
      db.insert(productAsset).values({
        id: sizeGuideId,
        productId: input.productId,
        storageKey,
        contentSha256: sha256,
        contentType: input.contentType,
        sizeBytes: size,
        createdAt: now,
      }) as unknown as DbStatement,
      db
        .update(productDraft)
        .set({ sizeGuideAssetId: sizeGuideId, updatedAt: now })
        .where(eq(productDraft.productId, input.productId)) as unknown as DbStatement,
      /**
       * POINTED AWAY FIRST, DELETED SECOND. The draft's foreign key still names
       * the outgoing row while this batch runs, so deleting it before the
       * update above would be a live reference at the moment of the delete.
       */
      ...outgoing.statements,
      db
        .update(product)
        .set({ updatedAt: now })
        .where(eq(product.id, input.productId)) as unknown as DbStatement,
    ],
    response: ok({ sizeGuideAssetId: sizeGuideId, href: mediaHref(sizeGuideId) }),
    facts: {
      targetType: "size_guide",
      targetId: sizeGuideId,
      detail: {
        productId: input.productId,
        size,
        replaced: draft.current,
        retainedForReleases: outgoing.retained,
      },
    },
    /** Bytes last, and allowed to fail — see `CoreOutcome.onCommitted`. */
    onCommitted: blobs.delete(outgoing.keys),
  };
});

/**
 * TAKE THE PLATE OFF THE DRAFT.
 *
 * The reference, the alt text and the fit comments all clear together, because
 * `Size & fit` is one panel and half of one is not a state worth being able to
 * reach. Whether the ASSET goes with them is the released-content question
 * again, answered the same way as in {@link putProductSizeGuide}: unreferenced
 * means deleted, referenced means retained. `retainedForReleases` is returned
 * rather than hidden so the console can say which of the two happened —
 * "removed from the draft; N published release(s) keep it" is a different fact
 * from "deleted", and an operator is entitled to both.
 *
 * Removing when there is nothing to remove is `not_found` rather than a silent
 * success: the caller believed there was a plate, and there was not.
 */
export const removeProductSizeGuide = Effect.fn("Media.removeProductSizeGuide")(function* (
  db: ClassicDb,
  productId: string,
  now: number,
): Effect.fn.Return<
  CoreOutcome<{ removed: true; retainedForReleases: number }, "not_found">,
  never,
  Blobs
> {
  const drafts = yield* query(() =>
    db
      .select({ current: productDraft.sizeGuideAssetId })
      .from(productDraft)
      .where(eq(productDraft.productId, productId))
      .limit(1),
  );
  const current = drafts[0]?.current;
  if (current === undefined || current === null) return { failure: err("not_found") };

  const blobs = yield* Blobs;
  const outgoing = yield* retirePlate(db, current);

  return {
    statements: [
      db
        .update(productDraft)
        .set({
          sizeGuideAssetId: null,
          sizeGuideAlt: null,
          sizeGuideNotesMarkdown: null,
          updatedAt: now,
        })
        .where(eq(productDraft.productId, productId)) as unknown as DbStatement,
      /** Pointed away first, deleted second — same ordering as the replace path. */
      ...outgoing.statements,
      db
        .update(product)
        .set({ updatedAt: now })
        .where(eq(product.id, productId)) as unknown as DbStatement,
    ],
    response: ok({ removed: true as const, retainedForReleases: outgoing.retained }),
    facts: {
      targetType: "size_guide",
      targetId: current,
      detail: { productId, retainedForReleases: outgoing.retained },
    },
    onCommitted: blobs.delete(outgoing.keys),
  };
});
