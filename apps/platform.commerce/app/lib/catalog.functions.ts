/**
 * The catalogue, over the binding.
 *
 * EVERY HANDLER IS A PASS-THROUGH. It builds the envelope, calls Commerce, and
 * returns whatever came back — including refusals, which are VALUES here rather
 * than exceptions. `missing_variant`, `missing_media`, `revision_conflict` and
 * `cap_below_claimed` are the domain telling the operator the sequence they are
 * in, and swallowing them into a generic error would delete the only useful
 * thing publish says.
 *
 * No handler validates a business rule. Every one of them is enforced inside
 * Commerce, on the far side of a boundary the browser cannot route around, and
 * a second copy here would be a second thing to keep in step.
 *
 * Each is a top-level `createServerFn` because the Start compiler AST-extracts
 * handlers keyed on the declaration — they cannot live in a shared factory and
 * be re-exported.
 */
import { createServerFn } from "@tanstack/react-start";

import type {
  AdjustStockInput,
  CreateProductInput,
  IngestProductMediaInput,
  ListProductsInput,
  ProductStatus,
  PublishProductInput,
  PutProductSizeGuideInput,
  PutVariantInput,
  ReorderProductMediaInput,
  SaveProductDraftInput,
} from "../../domain/Contracts.ts";
import { commerce } from "./commerce.server.ts";
import { operatorCall, requireOperator } from "./server-fn-actor.ts";

// ── Reads ────────────────────────────────────────────────────────────────────

export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .validator((data: ListProductsInput) => data)
  .handler(async ({ context, data }) =>
    commerce().listProducts({
      input: data,
      /**
       * A READ, so the envelope's idempotency key is inert — nothing is
       * recorded and there is nothing to replay. It is still built from the
       * verified actor rather than stubbed, because `meta.actor` is what
       * Commerce trusts and a read that fabricated one would be the template
       * someone copies for a write.
       */
      meta: {
        actor: context.actor,
        requestId: crypto.randomUUID(),
        idempotencyKey: `${context.actor.sub}:listProducts:read`,
      },
    }),
  );

export const getProduct = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .validator((data: { productId: string }) => data)
  .handler(async ({ context, data }) =>
    commerce().getProduct({
      input: data,
      meta: {
        actor: context.actor,
        requestId: crypto.randomUUID(),
        idempotencyKey: `${context.actor.sub}:getProduct:read`,
      },
    }),
  );

// ── Lifecycle ────────────────────────────────────────────────────────────────

export const createProduct = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: CreateProductInput & { commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().createProduct(operatorCall(context.actor, "createProduct", commandId, input));
  });

export const saveProductDraft = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: SaveProductDraftInput & { commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    /**
     * `expectedRevision` travels from the read the form was rendered from, so
     * two tabs open on one product means the second save loses with
     * `revision_conflict` rather than silently overwriting the first.
     */
    return commerce().saveProductDraft(
      operatorCall(context.actor, "saveProductDraft", commandId, input),
    );
  });

export const publishProduct = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: PublishProductInput & { commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().publishProduct(
      operatorCall(context.actor, "publishProduct", commandId, input),
    );
  });

export const setProductStatus = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: { productId: string; status: ProductStatus; commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().setProductStatus(
      operatorCall(context.actor, "setProductStatus", commandId, input),
    );
  });

// ── Variants and stock ───────────────────────────────────────────────────────

export const putVariant = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: PutVariantInput & { commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().putVariant(operatorCall(context.actor, "putVariant", commandId, input));
  });

export const adjustStock = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: AdjustStockInput & { commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    /**
     * A RELATIVE delta, never a value typed from a stale read — the same reason
     * checkout reserves with a guarded conditional UPDATE. Two operators
     * adjusting at once both apply; two operators SETTING at once lose one.
     */
    return commerce().adjustStock(operatorCall(context.actor, "adjustStock", commandId, input));
  });

export const setPreorderCap = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: { productId: string; cap: number | null; commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().setPreorderCap(
      operatorCall(context.actor, "setPreorderCap", commandId, input),
    );
  });

// ── Media ────────────────────────────────────────────────────────────────────

/**
 * One text field out of a multipart body.
 *
 * `FormData.get` returns `string | File | null`, so a bare `String(...)` on it
 * turns an uploaded file into the literal `"[object File]"` — which for
 * `productId` would be a lookup that silently finds nothing rather than a
 * rejected request.
 */
const field = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * FORMDATA, not JSON with base64.
 *
 * The bytes reach Commerce as an `ArrayBuffer` over a service binding, which is
 * a structured clone rather than a serialisation — so the only encoding
 * question is browser-to-here, and a multipart body answers it without
 * inflating a 10 MB photograph to 13 MB of base64 and back. The spike's console
 * did the base64 round trip because its transport was a JSON `/api` POST.
 */
export const ingestProductMedia = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: FormData) => data)
  .handler(async ({ context, data }) => {
    const file = data.get("file");
    if (!(file instanceof File)) {
      throw new Response("no file in upload", { status: 400 });
    }

    const productId = field(data, "productId");
    const commandId = field(data, "commandId");
    const altField = field(data, "alt").trim();

    const input: IngestProductMediaInput = {
      productId,
      bytes: await file.arrayBuffer(),
      /**
       * The browser's type, and Commerce refuses anything outside its
       * allowlist with `unsupported_type` — so a lie here is a refusal rather
       * than a stored file of the wrong kind.
       */
      contentType: file.type,
      /** Falling back to the filename beats storing an empty alt for a real image. */
      alt: altField || file.name,
    };

    /**
     * NO POSITION AND NO ROLE. An upload lands at the END of the order, which
     * is the one place a new photograph can go without silently changing which
     * one leads. `reorderProductMedia` is how it moves from there.
     */
    return commerce().ingestProductMedia(
      operatorCall(context.actor, "ingestProductMedia", commandId, input),
    );
  });

/**
 * THE SIZE-GUIDE PLATE, uploaded or replaced. Multipart for the same reason
 * `ingestProductMedia` is: the bytes cross a service binding as an
 * `ArrayBuffer`, so there is no base64 round trip to pay for.
 *
 * The alt text and the fit comments are NOT here — they are draft copy and
 * travel through `saveProductDraft`, because a release freezes them and does
 * not freeze the bytes.
 */
export const putProductSizeGuide = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: FormData) => data)
  .handler(async ({ context, data }) => {
    const file = data.get("file");
    if (!(file instanceof File)) {
      throw new Response("no file in upload", { status: 400 });
    }

    const input: PutProductSizeGuideInput = {
      productId: field(data, "productId"),
      bytes: await file.arrayBuffer(),
      /** The store's display allowlist, same as product photography. */
      contentType: file.type,
    };

    return commerce().putProductSizeGuide(
      operatorCall(context.actor, "putProductSizeGuide", field(data, "commandId"), input),
    );
  });

export const removeProductSizeGuide = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: { productId: string; commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().removeProductSizeGuide(
      operatorCall(context.actor, "removeProductSizeGuide", commandId, input),
    );
  });

export const reorderProductMedia = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .validator((data: ReorderProductMediaInput & { commandId: string }) => data)
  .handler(async ({ context, data }) => {
    const { commandId, ...input } = data;
    return commerce().reorderProductMedia(
      operatorCall(context.actor, "reorderProductMedia", commandId, input),
    );
  });
