# RFC-001 — Non-destructive image framing

**Status:** Proposed
**Affects:** `platform.commerce` (schema, contracts, media domain), `platform.site` (storefront), operator console

## Context

Two numbers are currently hardcoded in `apps/platform.site/src/styles/product.css`,
and both are guesses standing in for data the store does not record.

```css
.product-shot img {
  object-position: 65% center;
} /* every product, forever */
.product-size-chart {
  aspect-ratio: 1140 / 432;
} /* one chart's shape */
```

`object-position: 65% center` decides which part of every photograph in the shop
survives the `cover` crop. It was chosen against one photograph. Any product
whose subject sits left of centre is cropped wrong, and the only remedy today is
re-shooting or re-exporting the image.

`aspect-ratio: 1140 / 432` is the shape of the one size chart in the repo. It was
written the day that chart was redrawn, and it silently letterboxes any chart
uploaded at a different shape — the exact failure it was introduced to fix, moved
one step down the road.

Neither can be fixed by editing CSS harder. Both are per-asset facts, and the
store has nowhere to put them.

### What the schema already gets right

`product_asset` holds bytes: `storage_key`, `content_sha256`, `content_type`,
`size_bytes`. `product_image` holds a **use** of those bytes — `alt`, `position` —
keyed by the asset id. `product_release_image` freezes that use at publish time.

This split is the reason this RFC is small. Framing is a property of a use, and
there is already a table for uses.

### Non-goals

- Server-side image processing, derived variants, or a rendition pipeline.
- A drag-handle crop rectangle. See ADR-2.
- Changing what `cover` means for the gallery, or the one-viewport layout.
- Art direction per breakpoint (a different crop on mobile). Possible later on
  the same columns; deliberately not in scope.

## ADRs

### ADR-1 — Framing lives on the use, and bytes are never rewritten

**Decision.** An upload is stored once, whole, and never modified. Framing is
recorded alongside the reference to it, never baked into it.

**Why the alternative loses.** Cropping on upload means either mutating bytes a
published release points at, or writing a second object per crop. The first
rewrites what a buyer was shown, which `product_release.size_guide_asset_id`
exists specifically to prevent — its `onDelete: "restrict"` is there because a
chart must never change or vanish out of a published release. The second
multiplies storage per crop and gives the operator no way back to the original.

`content_sha256` also stops meaning anything useful once bytes are edited
in place: it is the identity of an upload, not of a rendition.

**Consequence.** Re-framing is free and reversible. It costs an `UPDATE` of two
integers and never touches R2.

### ADR-2 — A focal point, not a crop rectangle

**Decision.** The operator sets the point that must remain visible. Store
`focal_x` and `focal_y` as integer percentages on the use. The storefront renders
`object-position: <focal_x>% <focal_y>%` and keeps `object-fit: cover`.

**Why the alternative loses.** A crop rectangle has to be _rendered_. Either the
server produces the cropped bytes — a processing pipeline, R2 variants, cache
invalidation, and a second source of truth for what an image looks like — or the
client re-derives the crop in CSS, which is `object-position` plus arithmetic
that only works for one container aspect at a time. The rectangle is also the
wrong shape of answer: the gallery plate resizes with the viewport, so the
correct crop is different at every width. A focal point is aspect-independent by
construction.

The UI cost differs by an order of magnitude. A focal point is a click on a
preview. A cropper is drag handles, zoom, pinch, and a keyboard story for each.

**Cost accepted.** An operator cannot express "crop out the left third". They can
only say what must stay. For a product gallery that is the question actually
being asked.

### ADR-3 — Display aspect belongs to the slot, except where it belongs to the asset

**Decision.**

- **Gallery.** The plate is one fixed field. Aspect is the slot's, not the
  image's. No per-image aspect.
- **Size guide.** The panel is sized _by the artwork_. Aspect comes from the
  asset's intrinsic dimensions, recorded at upload.

**Why per-image aspect loses for the gallery.** The filmstrip swaps between shots
by flipping `hidden`. If each shot declared its own aspect, the plate would
resize as the shopper clicks through — the page would jump under a control whose
only job is to change the picture. The alternative, honouring the first image's
aspect and ignoring the rest, is a rule nobody could predict from the UI.

**Why intrinsic dimensions win for the size guide.** There is exactly one chart
per product and it gets its own box. The box should be the shape of the file.
This deletes the hardcoded ratio rather than relocating it.

### ADR-4 — Dimensions are read from the file, not reported by the client

**Decision.** `ingestProductMedia` and `putProductSizeGuide` parse width and
height out of the uploaded bytes' header, server-side. Both columns are nullable,
and a parse failure stores `NULL` rather than refusing the upload.

**Why the alternative loses.** The operator console has the image decoded and
could send `naturalWidth`/`naturalHeight` in the payload — one line instead of a
parser. But then a layout fact about a file the store serves is asserted by the
client, and the store has no way to check it. It is not a security hole so much
as a category error: the store owns the bytes, so the store owns their shape.

Header parsing is bounded and deterministic for the formats in
`ALLOWED_CONTENT_TYPES` — PNG `IHDR`, JPEG `SOF0/2`, WebP `VP8X`/`VP8 `/`VP8L`,
GIF logical screen descriptor, SVG `width`/`height` or `viewBox`. It reads the
first few hundred bytes and never decodes pixels.

**Why nullable rather than required.** Every asset already in the store predates
this column, and an unparseable-but-displayable file must not become
un-uploadable. `NULL` means "render exactly as today", which keeps INV-4 cheap.

## Schema

```
product_asset
  + width         integer NULL   -- intrinsic pixels, NULL when unread
  + height        integer NULL
  CHECK (width  IS NULL OR width  > 0)
  CHECK (height IS NULL OR height > 0)

product_image
  + focal_x       integer NOT NULL DEFAULT 50   -- percent from the left
  + focal_y       integer NOT NULL DEFAULT 50   -- percent from the top
  CHECK (focal_x BETWEEN 0 AND 100)
  CHECK (focal_y BETWEEN 0 AND 100)

product_release_image
  + focal_x       integer NOT NULL DEFAULT 50
  + focal_y       integer NOT NULL DEFAULT 50
  CHECK (focal_x BETWEEN 0 AND 100)
  CHECK (focal_y BETWEEN 0 AND 100)
```

`50/50` is the default because it is what `object-position: center` already
means — an existing product's framing must not move on migration day.

Width and height go on the **asset**, not the use: they are a fact about the
bytes, identical for every use of them. Focal point goes on the **use**, because
the same photograph could reasonably be framed differently in two places.

`product_release_image` carries its own copy for the reason it already carries
`alt` and `position`: a release is what a buyer saw.

## API surface

### `ingestProductMedia`

- **Pre:** `contentType ∈ ALLOWED_CONTENT_TYPES`; caller holds operator access to
  `productId`.
- **Post:** exactly one `product_asset` row; `width`/`height` set from the header
  when parseable, `NULL` otherwise; one `product_image` row at the end of the
  order with `focal_x = focal_y = 50`.
- **Unchanged:** the failure modes. A file whose header will not parse is a
  successful upload with unknown dimensions, not a refusal.

### `putProductSizeGuide`

- **Pre:** as above.
- **Post:** as above, minus the `product_image` row. `width`/`height` recorded on
  the asset; the storefront reads them to size the panel.

### `setProductMediaFocalPoint` (new)

- **Payload:** `{ productId, assetId, focalX, focalY }`, both integers validated
  `0 ≤ n ≤ 100` at the contract boundary.
- **Pre:** the asset is a member of that product's draft media.
- **Post:** the draft's `product_image` row carries the new point. **No published
  release changes.**
- **Errors:** `NotFound` for an asset that is not this product's.

### `StorefrontProductDTO`

```
media[].focalX     : number   -- 0..100
media[].focalY     : number   -- 0..100
sizeGuide.width    : number | null
sizeGuide.height   : number | null
```

The storefront reads framing from the release, never from the draft — the same
path everything else on the product page already takes.

## Invariants

- **INV-1** Asset bytes are never modified after `ingestProductMedia` or
  `putProductSizeGuide` returns. A framing change writes no object to R2.
- **INV-2** Editing a draft's focal point does not change any published release's
  rendering. Publishing copies the draft's framing into `product_release_image`.
- **INV-3** `focal_x` and `focal_y` are integers in `[0, 100]`, enforced at the
  contract boundary _and_ by a `CHECK`. Neither alone is sufficient: the contract
  protects the storefront, the constraint protects against a future writer that
  bypasses it.
- **INV-4** An asset with `width IS NULL` renders exactly as it does today. Absent
  dimensions is a permanent supported state, not a migration window.
- **INV-5** No operator-authored string is interpolated into a `style` attribute.
  Framing reaches CSS only as validated integers, and the size guide's
  `aspect-ratio` only as two validated integers.
- **INV-6** A product with no focal point set renders identically before and after
  this RFC ships — `50/50` is `center`, which is what `object-position` defaults
  to. (Note: this makes today's `65% center` a **deliberate** change, not an
  accident. See Open questions.)

## Threat model

The new surface is operator-supplied numbers that reach a `style` attribute on a
public page. That is a CSS injection vector if it is ever a string.

- **Refuse at the contract.** `focalX`/`focalY` are `Schema.Int` with a
  `between(0, 100)` refinement — not `Schema.Number`, not clamped downstream.
  A non-integer or out-of-range value is a rejected RPC, not a corrected one.
- **Refuse at the database.** The `CHECK` constraints mean a value that somehow
  reached the writer still cannot land.
- **Interpolate as a number.** The storefront builds `object-position` from two
  numbers it has re-read from the DTO; it never concatenates an operator string.
- **Dimensions are ours.** Per ADR-4 the store parses them, so an operator cannot
  assert an aspect ratio at all. A hostile file yields `NULL`, which renders as
  today.
- **Unchanged:** nothing here widens what may be uploaded.
  `ALLOWED_CONTENT_TYPES` is untouched.

## Stages

Each stage ships and is useful alone.

**Stage 1 — record dimensions.** Header parser, two columns on `product_asset`,
backfill from R2 for existing assets, `sizeGuide.width/height` on the DTO, the
size-guide panel sized from data. **Deletes `aspect-ratio: 1140 / 432`.** No UI
work in the operator console. This is the stage that pays for itself immediately:
it is the bug that shipped last week.

**Stage 2 — focal point.** Four columns, `setProductMediaFocalPoint`, publish
copies the framing, storefront renders `object-position`. **Deletes
`object-position: 65% center`.**

**Stage 3 — the operator control.** Click a preview to set the point, with the
gallery's own aspect drawn over it so the operator sees what will be cut. The
smallest honest version is a preview with a crosshair; it needs no library.

Stage 3 is the only stage with meaningful UI cost, and Stages 1 and 2 are worth
shipping before it — Stage 2 without Stage 3 still lets a focal point be set
through the API, and Stage 1 needs no operator input at all.

## Test requirements

- Header parser: one fixture per allowed content type, plus a truncated file, a
  file with a lying extension, and an SVG with `viewBox` but no `width`. Assert
  `NULL` on every failure path, never a throw.
- `ingestProductMedia` records dimensions and defaults framing to `50/50`.
- `setProductMediaFocalPoint` rejects `-1`, `101`, `50.5`, `"50"`, and `NaN` at
  the contract boundary — one case each, asserting refusal rather than coercion.
- Publish copies draft framing into the release; a subsequent draft edit leaves
  the published release's framing unchanged (INV-2).
- `productView` maps focal point onto the plate and asset dimensions onto the
  chart, with a null-dimensions product falling back to today's rendering
  (INV-4). These are `core/product-view.ts` tests — no renderer.
- A migration test asserting an existing product's rendering is byte-identical
  before and after the migration, given no operator action (INV-6).

## Open questions

1. **`65% center` is currently deliberate.** Migrating to `50/50` re-centres every
   existing photograph. Either backfill `focal_x = 65` to preserve today's
   rendering exactly, or accept the change and let the operator re-point the
   handful of products that exist. Backfilling preserves a guess; not backfilling
   changes live pages without anyone asking. Recommend **backfill to 65/50**, then
   let Stage 3 replace it product by product — it keeps INV-6 true.
2. **Backfilling dimensions** means reading every existing asset out of R2 once.
   At the current catalogue size this is trivial; it is written down because it
   stops being trivial at some size and the migration should be resumable.
3. **Art direction per breakpoint** — a different focal point on mobile — is
   possible on these columns later. Not proposed, but the schema does not
   preclude it.
