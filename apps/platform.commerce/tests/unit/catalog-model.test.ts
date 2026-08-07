/**
 * THE CATALOG MODEL, against a real database.
 *
 * Every test here pins an INVARIANT of the release model rather than an
 * implementation: that ORDER alone decides what leads, that publishing FREEZES
 * what a buyer saw, that a draft edit cannot reach a published release, and
 * that a size-guide plate cannot vanish out of one. None of them assert that a
 * function calls another function.
 *
 * The database is `bun:sqlite` behind the D1 interface, with this package's own
 * migrations applied — see `LocalD1.ts`. So the schema under test is the schema
 * a deployment gets, `meta.changes` behaves, foreign keys are enforced, and a
 * batch is one transaction.
 *
 * WHY NOT THE INTEGRATION SUITE. `store.integ.test.ts` deploys the whole stack
 * and drives it over a typed RPC client, which is the right shape for an
 * end-to-end check and needs a Cloudflare account to run. These properties are
 * properties of SQL and should be provable on a laptop with no network.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import * as Catalog from "../../domain/Catalog.ts";
import * as Media from "../../domain/Media.ts";
import * as Storefront from "../../domain/Storefront.ts";
import { Blobs } from "../../services/Blobs.ts";
import type { CoreOutcome } from "../../services/Audit.ts";
import {
  draftMarket,
  productDraft,
  productImage,
  productRelease,
  productReleaseImage,
  productAsset,
} from "../../domain/Schema.ts";
import { makeLocalDatabase, type LocalDatabase } from "./LocalD1.ts";

// ── Harness ──────────────────────────────────────────────────────────────────

const ACTOR = "operator:test";
const NOW = 1_767_225_600_000;

/**
 * An in-memory `Blobs`. The domain writes bytes before rows, so the media path
 * cannot run without one — and what these tests care about is which KEYS were
 * deleted, which is exactly what a real bucket makes tedious to observe.
 */
const makeBlobs = () => {
  const objects = new Map<string, ArrayBuffer>();
  const deleted: string[] = [];
  const layer = Blobs.layer(
    Effect.succeed({
      put: async (key: string, bytes: ArrayBuffer) => {
        objects.set(key, bytes);
      },
      get: async (key: string) =>
        objects.has(key) ? { body: null, httpMetadata: {}, size: 0 } : null,
      delete: async (keys: string[]) => {
        for (const key of keys) {
          deleted.push(key);
          objects.delete(key);
        }
      },
      list: async () => ({ objects: [], truncated: false }),
    } as never),
  );
  return { layer, objects, deleted };
};

let store: LocalDatabase;
let blobs: ReturnType<typeof makeBlobs>;

beforeEach(() => {
  store = makeLocalDatabase();
  blobs = makeBlobs();
});

afterEach(() => {
  store.close();
});

/** Run a core and COMMIT its statements — the half `Audit.command` normally does. */
const commit = async <T, E extends string>(
  core: Effect.Effect<CoreOutcome<T, E>, never, Blobs>,
): Promise<T> => {
  const outcome = await Effect.runPromise(Effect.provide(core, blobs.layer));
  if ("failure" in outcome) {
    throw new Error(`core refused: ${JSON.stringify(outcome.failure)}`);
  }
  await store.run(outcome.statements);
  /**
   * THE AFTER-COMMIT EFFECT IS RUN, not skipped — it is where the R2 bytes
   * behind a removed size guide actually go, and "which keys were deleted" is
   * half of what the deletion tests assert. Production logs and swallows a
   * failure here (see `Audit.command`); a test must not, so a failure becomes a
   * rejected promise and fails the case.
   */
  if (outcome.onCommitted) {
    await Effect.runPromise(
      Effect.catchCause(outcome.onCommitted, (cause) =>
        Effect.fail(new Error(`onCommitted failed: ${String(cause)}`)),
      ),
    );
  }
  return outcome.response.value;
};

/** The same, for a core expected to REFUSE. Returns the typed failure. */
const refusal = async <T, E extends string>(
  core: Effect.Effect<CoreOutcome<T, E>, never, Blobs>,
): Promise<{ ok: false; error: E }> => {
  const outcome = await Effect.runPromise(Effect.provide(core, blobs.layer));
  if (!("failure" in outcome)) throw new Error("expected a refusal, got a success");
  return outcome.failure as { ok: false; error: E };
};

let sequence = 0;
/** Monotonic ULID-shaped ids, so `(position, id)` tiebreaks are deterministic. */
const nextId = (): string => `01JQ${String(sequence++).padStart(22, "0")}`;

const png = (byte: number): ArrayBuffer => new Uint8Array([byte, byte, byte, byte]).buffer;

/** A product with a draft, a market and one size — everything publish demands but media. */
const seedProduct = async (slug: string): Promise<string> => {
  const productId = nextId();
  await commit(Catalog.createProduct(store.db, { slug, title: slug }, ACTOR, NOW, productId));
  await store.run([
    store.db
      .insert(draftMarket)
      .values({ productId, market: "CA", priceCents: 6_969, active: true }) as never,
  ]);
  await commit(
    Catalog.putVariant(
      store.db,
      { productId, size: "M", sku: `${slug}-M`, stock: 5 },
      NOW,
      nextId(),
    ),
  );
  return productId;
};

const addImage = (productId: string, alt: string, byte: number) =>
  commit(
    Media.ingestProductMedia(
      store.db,
      { productId, bytes: png(byte), contentType: "image/png", alt },
      NOW,
      nextId(),
    ),
  );

const publish = (productId: string, revision: number) =>
  commit(
    Catalog.publishProduct(
      store.db,
      { productId, expectedRevision: revision },
      ACTOR,
      NOW,
      nextId(),
    ),
  );

const draftOf = async (productId: string) => {
  const outcome = await Effect.runPromise(
    Effect.provide(Catalog.getProduct(store.db, productId), blobs.layer),
  );
  if ("failure" in outcome) throw new Error("product vanished");
  return outcome.response.value;
};

// ── 1. Order alone controls the cover and the storefront ordering ────────────

describe("media order is the whole presentation model", () => {
  test("the cover is the lowest-positioned image, and reordering moves it", async () => {
    const productId = await seedProduct("cover-follows-order");
    const first = await addImage(productId, "front", 1);
    const second = await addImage(productId, "back", 2);

    // Appended, so the upload order IS the position order.
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);

    await publish(productId, 1);
    const before = await Effect.runPromise(
      Effect.provide(Storefront.listActiveProducts(store.db, "CA"), blobs.layer),
    );
    expect(before[0]?.coverHref).toBe(`/media/${first.id}`);

    /**
     * THE SAME TWO IMAGES, THE OTHER WAY ROUND. Nothing else changes — no
     * label, no flag — and that has to be enough to change which one leads.
     */
    await commit(
      Catalog.reorderProductMedia(store.db, { productId, mediaIds: [second.id, first.id] }, NOW),
    );
    const draft = await draftOf(productId);
    await publish(productId, draft.draft.revision);

    const after = await Effect.runPromise(
      Effect.provide(Storefront.listActiveProducts(store.db, "CA"), blobs.layer),
    );
    expect(after[0]?.coverHref).toBe(`/media/${second.id}`);
  });

  test("the storefront serves media in position order", async () => {
    const productId = await seedProduct("ordered-media");
    const a = await addImage(productId, "one", 1);
    const b = await addImage(productId, "two", 2);
    const c = await addImage(productId, "three", 3);

    await commit(
      Catalog.reorderProductMedia(store.db, { productId, mediaIds: [c.id, a.id, b.id] }, NOW),
    );
    const draft = await draftOf(productId);
    await publish(productId, draft.draft.revision);

    const product = await Effect.runPromise(
      Effect.provide(
        Storefront.getActiveProductBySlug(store.db, "ordered-media", "CA"),
        blobs.layer,
      ),
    );
    expect(product?.media.map((image) => image.alt)).toEqual(["three", "one", "two"]);
  });

  /**
   * THE REORDER ITSELF, and the reason `(product_id, position)` is not a UNIQUE
   * index. A swap writes `position = 0` to the row that already holds it before
   * the other row moves off it; SQLite checks a unique index after EACH
   * statement in a batch, so the constraint would abort the ordinary gesture.
   */
  test("swapping two images does not collide on an intermediate position", async () => {
    const productId = await seedProduct("swap");
    const a = await addImage(productId, "one", 1);
    const b = await addImage(productId, "two", 2);

    await commit(Catalog.reorderProductMedia(store.db, { productId, mediaIds: [b.id, a.id] }, NOW));

    const rows = store.raw
      .query(
        "SELECT i.asset_id AS id, i.position FROM product_image i" +
          " JOIN product_asset a ON a.id = i.asset_id" +
          " WHERE a.product_id = ? ORDER BY i.position",
      )
      .all(productId) as { id: string; position: number }[];
    expect(rows).toEqual([
      { id: b.id, position: 0 },
      { id: a.id, position: 1 },
    ]);
  });

  test("a partial or foreign reorder is refused rather than half-applied", async () => {
    const productId = await seedProduct("bad-reorder");
    const a = await addImage(productId, "one", 1);
    await addImage(productId, "two", 2);

    const failed = await refusal(
      Catalog.reorderProductMedia(store.db, { productId, mediaIds: [a.id] }, NOW),
    );
    expect(failed.error).toBe("invalid_order");
  });
});

// ── 2. One image renders without empty gallery UI ────────────────────────────

/**
 * The storefront's half of the one-image case: the DTO carries exactly one
 * entry, so `productView` has nothing to build a filmstrip from. The site's own
 * test (`platform.site/test/product-view.test.ts`) pins the rendering rule
 * itself; this pins that the data cannot mislead it.
 */
describe("a one-image product", () => {
  test("publishes and serves exactly one plate", async () => {
    const productId = await seedProduct("single");
    const only = await addImage(productId, "the only shot", 1);
    await publish(productId, 1);

    const product = await Effect.runPromise(
      Effect.provide(Storefront.getActiveProductBySlug(store.db, "single", "CA"), blobs.layer),
    );
    expect(product?.media).toHaveLength(1);
    expect(product?.media[0]?.href).toBe(`/media/${only.id}`);

    const card = await Effect.runPromise(
      Effect.provide(Storefront.listActiveProducts(store.db, "CA"), blobs.layer),
    );
    expect(card[0]?.coverHref).toBe(`/media/${only.id}`);
  });
});

// ── 3. Draft media edits do not mutate an active release ─────────────────────

describe("a published release is immutable while retained", () => {
  test("reordering, re-alting and adding draft media leaves the active release alone", async () => {
    const productId = await seedProduct("frozen-media");
    const a = await addImage(productId, "one", 1);
    const b = await addImage(productId, "two", 2);
    const release = await publish(productId, 1);

    const frozen = () =>
      store.db
        .select({
          imageId: productReleaseImage.imageId,
          alt: productReleaseImage.alt,
          position: productReleaseImage.position,
        })
        .from(productReleaseImage)
        .where(eq(productReleaseImage.releaseId, release.releaseId))
        .orderBy(asc(productReleaseImage.position));

    const before = await frozen();
    expect(before).toEqual([
      { imageId: a.id, alt: "one", position: 0 },
      { imageId: b.id, alt: "two", position: 1 },
    ]);

    // Every draft-side media gesture there is, all at once.
    await commit(Catalog.reorderProductMedia(store.db, { productId, mediaIds: [b.id, a.id] }, NOW));
    const added = await addImage(productId, "three", 3);
    await store.run([
      store.db
        .update(productImage)
        .set({ alt: "rewritten" })
        .where(eq(productImage.assetId, a.id)) as never,
    ]);

    expect(await frozen()).toEqual(before);

    /** And the storefront, which reads the release, still shows the old order. */
    const product = await Effect.runPromise(
      Effect.provide(
        Storefront.getActiveProductBySlug(store.db, "frozen-media", "CA"),
        blobs.layer,
      ),
    );
    expect(product?.media.map((image) => image.alt)).toEqual(["one", "two"]);
    expect(product?.media.map((image) => image.href)).not.toContain(`/media/${added.id}`);
  });
});

// ── 4. Publishing freezes the new content fields ─────────────────────────────

describe("publishing freezes description, details and the size guide", () => {
  test("the release keeps what it was published with after the draft moves on", async () => {
    const productId = await seedProduct("frozen-copy");
    await addImage(productId, "one", 1);

    const plate = await commit(
      Media.putProductSizeGuide(
        store.db,
        { productId, bytes: png(9), contentType: "image/png" },
        NOW,
        nextId(),
      ),
    );
    const withPlate = await draftOf(productId);
    await commit(
      Catalog.saveProductDraft(
        store.db,
        {
          productId,
          expectedRevision: withPlate.draft.revision,
          descriptionMarkdown: "As published.",
          detailsMarkdown: "240 GSM combed cotton.",
          sizeGuideAlt: "Pit-to-pit 50, 53, 56 cm.",
          sizeGuideNotesMarkdown: "Relaxed unisex fit.",
        },
        ACTOR,
        NOW,
      ),
    );

    const ready = await draftOf(productId);
    const release = await publish(productId, ready.draft.revision);

    /**
     * THEN THE DRAFT MOVES ON — every frozen field rewritten or cleared.
     *
     * The same revision the publish was taken at: publishing FREEZES the draft,
     * it does not consume it, so the working copy is exactly where it was and
     * the next edit is the next revision.
     */
    await commit(
      Catalog.saveProductDraft(
        store.db,
        {
          productId,
          expectedRevision: ready.draft.revision,
          descriptionMarkdown: "Edited after publishing.",
          detailsMarkdown: null,
          sizeGuideAlt: "Different numbers.",
          sizeGuideNotesMarkdown: null,
        },
        ACTOR,
        NOW,
      ),
    );
    await commit(Media.removeProductSizeGuide(store.db, productId, NOW));

    const rows = await store.db
      .select()
      .from(productRelease)
      .where(eq(productRelease.id, release.releaseId));
    expect(rows[0]).toMatchObject({
      descriptionMarkdown: "As published.",
      detailsMarkdown: "240 GSM combed cotton.",
      sizeGuideAssetId: plate.sizeGuideAssetId,
      sizeGuideAlt: "Pit-to-pit 50, 53, 56 cm.",
      sizeGuideNotesMarkdown: "Relaxed unisex fit.",
    });

    /** And the shopper still gets the published panel, not the edited draft. */
    const product = await Effect.runPromise(
      Effect.provide(Storefront.getActiveProductBySlug(store.db, "frozen-copy", "CA"), blobs.layer),
    );
    expect(product?.descriptionMarkdown).toBe("As published.");
    expect(product?.detailsMarkdown).toBe("240 GSM combed cotton.");
    expect(product?.sizeGuide).toEqual({
      href: `/media/${plate.sizeGuideAssetId}`,
      alt: "Pit-to-pit 50, 53, 56 cm.",
      notesMarkdown: "Relaxed unisex fit.",
    });
  });

  test("an omitted field is left alone; an explicit null clears it", async () => {
    const productId = await seedProduct("patch-semantics");
    await commit(
      Catalog.saveProductDraft(
        store.db,
        { productId, expectedRevision: 1, detailsMarkdown: "Kept." },
        ACTOR,
        NOW,
      ),
    );

    // A market save names no copy at all — it must not blank the details.
    await commit(
      Catalog.saveProductDraft(
        store.db,
        {
          productId,
          expectedRevision: 2,
          markets: [{ market: "CA", priceCents: 7_500, active: true }],
        },
        ACTOR,
        NOW,
      ),
    );
    expect((await draftOf(productId)).draft.detailsMarkdown).toBe("Kept.");

    await commit(
      Catalog.saveProductDraft(
        store.db,
        { productId, expectedRevision: 3, detailsMarkdown: null },
        ACTOR,
        NOW,
      ),
    );
    expect((await draftOf(productId)).draft.detailsMarkdown).toBeNull();
  });
});

// ── 5. Absent optional content produces no panel ─────────────────────────────

describe("a product with no details and no size guide", () => {
  test("publishes with both fields null, so the storefront has no panel to render", async () => {
    const productId = await seedProduct("bare");
    await addImage(productId, "one", 1);
    await publish(productId, 1);

    const product = await Effect.runPromise(
      Effect.provide(Storefront.getActiveProductBySlug(store.db, "bare", "CA"), blobs.layer),
    );
    expect(product?.detailsMarkdown).toBeNull();
    expect(product?.sizeGuide).toBeNull();
  });

  /**
   * ALT AND COMMENTS WITHOUT A CHART ARE NOT A PANEL. They are what is left
   * after one was removed, and the DTO has to say so or the page renders a
   * `Size & fit` drawer that opens onto captions for an image nobody uploaded.
   */
  test("size-guide words with no plate still produce no panel", async () => {
    const productId = await seedProduct("words-only");
    await addImage(productId, "one", 1);
    await commit(
      Catalog.saveProductDraft(
        store.db,
        {
          productId,
          expectedRevision: 1,
          sizeGuideAlt: "orphaned",
          sizeGuideNotesMarkdown: "orphaned",
        },
        ACTOR,
        NOW,
      ),
    );
    const ready = await draftOf(productId);
    await publish(productId, ready.draft.revision);

    const product = await Effect.runPromise(
      Effect.provide(Storefront.getActiveProductBySlug(store.db, "words-only", "CA"), blobs.layer),
    );
    expect(product?.sizeGuide).toBeNull();
  });
});

// ── 6. Size-guide deletion and reference behaviour ───────────────────────────

describe("a size-guide plate a release still names", () => {
  test("is retained when removed from the draft, and its bytes are kept", async () => {
    const productId = await seedProduct("retained-plate");
    await addImage(productId, "one", 1);
    const plate = await commit(
      Media.putProductSizeGuide(
        store.db,
        { productId, bytes: png(9), contentType: "image/png" },
        NOW,
        nextId(),
      ),
    );
    const ready = await draftOf(productId);
    await publish(productId, ready.draft.revision);

    const removed = await commit(Media.removeProductSizeGuide(store.db, productId, NOW));
    expect(removed.retainedForReleases).toBe(1);

    /** The DRAFT lost it — reference, alt and comments together. */
    const after = await draftOf(productId);
    expect(after.draft.sizeGuideAssetId).toBeNull();
    expect(after.draft.sizeGuideAlt).toBeNull();
    expect(after.draft.sizeGuideNotesMarkdown).toBeNull();

    /** The ASSET and its bytes did not. */
    const rows = await store.db
      .select()
      .from(productAsset)
      .where(eq(productAsset.id, plate.sizeGuideAssetId));
    expect(rows).toHaveLength(1);
    expect(blobs.deleted).toHaveLength(0);

    /** And the live product page still renders the chart it was published with. */
    const product = await Effect.runPromise(
      Effect.provide(
        Storefront.getActiveProductBySlug(store.db, "retained-plate", "CA"),
        blobs.layer,
      ),
    );
    expect(product?.sizeGuide?.href).toBe(`/media/${plate.sizeGuideAssetId}`);
  });

  test("an unreferenced plate is deleted outright, bytes and all", async () => {
    const productId = await seedProduct("unreferenced-plate");
    const plate = await commit(
      Media.putProductSizeGuide(
        store.db,
        { productId, bytes: png(9), contentType: "image/png" },
        NOW,
        nextId(),
      ),
    );

    const removed = await commit(Media.removeProductSizeGuide(store.db, productId, NOW));
    expect(removed.retainedForReleases).toBe(0);

    const rows = await store.db
      .select()
      .from(productAsset)
      .where(eq(productAsset.id, plate.sizeGuideAssetId));
    expect(rows).toHaveLength(0);
    expect(blobs.deleted).toEqual([`products/${productId}/${plate.sizeGuideAssetId}`]);
  });

  test("replacing a published plate keeps the old one and repoints only the draft", async () => {
    const productId = await seedProduct("replaced-plate");
    await addImage(productId, "one", 1);
    const original = await commit(
      Media.putProductSizeGuide(
        store.db,
        { productId, bytes: png(1), contentType: "image/png" },
        NOW,
        nextId(),
      ),
    );
    const ready = await draftOf(productId);
    const release = await publish(productId, ready.draft.revision);

    const replacement = await commit(
      Media.putProductSizeGuide(
        store.db,
        { productId, bytes: png(2), contentType: "image/png" },
        NOW,
        nextId(),
      ),
    );

    expect((await draftOf(productId)).draft.sizeGuideAssetId).toBe(replacement.sizeGuideAssetId);
    const frozen = await store.db
      .select({ id: productRelease.sizeGuideAssetId })
      .from(productRelease)
      .where(eq(productRelease.id, release.releaseId));
    expect(frozen[0]?.id).toBe(original.sizeGuideAssetId);
    expect(blobs.deleted).toHaveLength(0);
  });

  /**
   * THE DATABASE ITSELF REFUSES, which is the point of the `RESTRICT` foreign
   * key. The domain never issues this statement — but a future one that did,
   * by cascade or by hand, would be stopped rather than silently stripping a
   * chart out of what a buyer was shown.
   */
  test("cannot be deleted out from under a release, even by raw SQL", async () => {
    const productId = await seedProduct("restrict");
    await addImage(productId, "one", 1);
    const plate = await commit(
      Media.putProductSizeGuide(
        store.db,
        { productId, bytes: png(9), contentType: "image/png" },
        NOW,
        nextId(),
      ),
    );
    const ready = await draftOf(productId);
    await publish(productId, ready.draft.revision);

    expect(() =>
      store.raw.query("DELETE FROM product_asset WHERE id = ?").run(plate.sizeGuideAssetId),
    ).toThrow();
  });

  /**
   * A SIZE GUIDE IS HELD TO THE SAME FORMAT RULE AS A PHOTOGRAPH, and this
   * test exists because it briefly was not: the plate had a PNG-only allowlist
   * of its own, on the reasoning that it composites over a background and so
   * "needs" an alpha channel. That is a rendering preference, not a validation
   * rule — an opaque chart is a perfectly good chart, and a content type says
   * nothing about an alpha channel anyway.
   *
   * JPEG is the case that matters: the one common format that CANNOT be
   * transparent. If it is accepted, no transparency constraint is being
   * smuggled in. Enumerating the whole allowlist here would only assert that a
   * constant equals itself.
   */
  test("takes a format that cannot be transparent, exactly as photography does", async () => {
    const productId = await seedProduct("opaque-plate");
    const plate = await commit(
      Media.putProductSizeGuide(
        store.db,
        { productId, bytes: png(255), contentType: "image/jpeg" },
        NOW,
        nextId(),
      ),
    );
    expect((await draftOf(productId)).draft.sizeGuideAssetId).toBe(plate.sizeGuideAssetId);
  });

  test("a format no browser renders is refused", async () => {
    const productId = await seedProduct("tiff");
    const failed = await refusal(
      Media.putProductSizeGuide(
        store.db,
        { productId, bytes: png(9), contentType: "image/tiff" },
        NOW,
        nextId(),
      ),
    );
    expect(failed.error).toBe("unsupported_type");
  });

  test("removing when there is no plate is a refusal, not a silent success", async () => {
    const productId = await seedProduct("nothing-to-remove");
    const failed = await refusal(Media.removeProductSizeGuide(store.db, productId, NOW));
    expect(failed.error).toBe("not_found");
  });

  /**
   * SERVED THROUGH THE SAME ADDRESS as product photography, and behind the same
   * status gate — a withdrawn product's chart stops being served at the instant
   * its photographs do.
   */
  test("is resolvable through the public media route only while the product is active", async () => {
    const productId = await seedProduct("served-plate");
    await addImage(productId, "one", 1);
    const plate = await commit(
      Media.putProductSizeGuide(
        store.db,
        { productId, bytes: png(9), contentType: "image/png" },
        NOW,
        nextId(),
      ),
    );

    // Still a draft: the public route must not serve it.
    const beforePublish = await Effect.runPromise(
      Effect.provide(Media.openMedia(store.db, plate.sizeGuideAssetId), blobs.layer),
    );
    expect(beforePublish).toBeNull();

    // The console can see it regardless — that window is why it exists.
    const operatorType = await Effect.runPromise(
      Effect.provide(Media.operatorMediaContentType(store.db, plate.sizeGuideAssetId), blobs.layer),
    );
    expect(operatorType).toBe("image/png");

    const ready = await draftOf(productId);
    await publish(productId, ready.draft.revision);
    const afterPublish = await Effect.runPromise(
      Effect.provide(Media.openMedia(store.db, plate.sizeGuideAssetId), blobs.layer),
    );
    expect(afterPublish).not.toBeNull();
  });
});

// ── 7. Sizes and add-to-cart still work ──────────────────────────────────────

describe("size selection is unchanged by the media rework", () => {
  test("the storefront publishes availability per size, derived from live stock", async () => {
    const productId = await seedProduct("sizes");
    await addImage(productId, "one", 1);
    await commit(
      Catalog.putVariant(
        store.db,
        { productId, size: "S", sku: "sizes-S", stock: 0 },
        NOW,
        nextId(),
      ),
    );
    await commit(
      Catalog.putVariant(
        store.db,
        { productId, size: "L", sku: "sizes-L", stock: 3 },
        NOW,
        nextId(),
      ),
    );
    await publish(productId, 1);

    const product = await Effect.runPromise(
      Effect.provide(Storefront.getActiveProductBySlug(store.db, "sizes", "CA"), blobs.layer),
    );
    expect(product?.variants.map((variant) => [variant.size, variant.available])).toEqual([
      ["S", false],
      ["M", true],
      ["L", true],
    ]);
  });

  /**
   * INVENTORY IS LIVE, NOT FROZEN. Selling the last unit of a size makes it
   * unbuyable on a page whose copy and media have not changed — which is the
   * reason stock sits outside the release model at all.
   */
  test("stock moving after publish changes availability without republishing", async () => {
    const productId = await seedProduct("live-stock");
    await addImage(productId, "one", 1);
    await publish(productId, 1);

    const variants = (await draftOf(productId)).variants;
    const only = variants[0];
    if (!only) throw new Error("seeded variant missing");
    await commit(
      Catalog.adjustStock(store.db, { variantId: only.id, delta: -5, reason: "sold out" }),
    );

    const product = await Effect.runPromise(
      Effect.provide(Storefront.getActiveProductBySlug(store.db, "live-stock", "CA"), blobs.layer),
    );
    expect(product?.variants[0]?.available).toBe(false);
  });

  test("publish still refuses a product with no media", async () => {
    const productId = await seedProduct("no-media");
    const failed = await refusal(
      Catalog.publishProduct(store.db, { productId, expectedRevision: 1 }, ACTOR, NOW, nextId()),
    );
    expect(failed.error).toBe("missing_media");
  });
});

// ── The draft's own reads ────────────────────────────────────────────────────

describe("the operator read", () => {
  test("carries positions in order and resolves the size-guide address", async () => {
    const productId = await seedProduct("operator-read");
    const a = await addImage(productId, "one", 1);
    const b = await addImage(productId, "two", 2);
    const plate = await commit(
      Media.putProductSizeGuide(
        store.db,
        { productId, bytes: png(9), contentType: "image/png" },
        NOW,
        nextId(),
      ),
    );

    const detail = await draftOf(productId);
    expect(detail.media.map((image) => [image.id, image.position])).toEqual([
      [a.id, 0],
      [b.id, 1],
    ]);
    expect(detail.draft.sizeGuideHref).toBe(`/media/${plate.sizeGuideAssetId}`);
  });

  /**
   * AN UPLOAD APPENDS, and it appends past a GAP. Deleting the middle image
   * leaves positions 0 and 2, so a count-based "next position" would hand the
   * newcomer position 2 as well and drop it into the middle of the strip.
   */
  test("an upload lands at the end even after a deletion left a gap", async () => {
    const productId = await seedProduct("append-past-gap");
    const a = await addImage(productId, "one", 1);
    const b = await addImage(productId, "two", 2);
    await addImage(productId, "three", 3);

    await store.run([store.db.delete(productAsset).where(eq(productAsset.id, b.id)) as never]);
    const added = await addImage(productId, "four", 4);
    expect(added.position).toBe(3);

    const detail = await draftOf(productId);
    expect(detail.media.map((image) => image.alt)).toEqual(["one", "three", "four"]);
    expect(detail.media[0]?.id).toBe(a.id);
  });
});

// ── The draft/release seam under concurrent edits ────────────────────────────

describe("the revision guard", () => {
  test("still refuses a stale save after the new copy fields were added", async () => {
    const productId = await seedProduct("stale");
    await commit(
      Catalog.saveProductDraft(
        store.db,
        { productId, expectedRevision: 1, detailsMarkdown: "first" },
        ACTOR,
        NOW,
      ),
    );

    const failed = await refusal(
      Catalog.saveProductDraft(
        store.db,
        { productId, expectedRevision: 1, detailsMarkdown: "second" },
        ACTOR,
        NOW,
      ),
    );
    expect(failed.error).toBe("revision_conflict");

    const rows = await store.db
      .select({ details: productDraft.detailsMarkdown })
      .from(productDraft)
      .where(and(eq(productDraft.productId, productId)));
    expect(rows[0]?.details).toBe("first");
  });
});
