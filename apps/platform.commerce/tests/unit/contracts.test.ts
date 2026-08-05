/**
 * The contract tier: the domain vocabulary and the wire schema, checked against
 * each other without a network.
 *
 * `Contracts.ts` used to restate every DTO by hand beside its `Schema` in
 * `Rpc.ts` — twelve types with no compile-time link, kept in step by reading.
 * Two had already drifted. The DTOs are now DERIVED, so drift is a build error;
 * what these tests add is the other half, which a type alias cannot give you:
 * that a value the domain actually produces survives the boundary.
 *
 * Decoding is what the Edge worker does to every inbound payload, so a payload
 * that decodes here is one a handler would really see.
 */
import { describe, expect, test } from "bun:test";
import * as Schema from "effect/Schema";

import type {
  DeletionPlan,
  OrderDetailDTO,
  ProductDraftDTO,
  ProductMediaDTO,
  ProductVariantDTO,
} from "../../domain/Contracts.ts";
import * as Rpc from "../../domain/Rpc.ts";

const draft: ProductDraftDTO = {
  productId: "01JQ0000000000000000000000",
  slug: "field-tee",
  revision: 3,
  title: "Field Tee",
  descriptionMarkdown: "Heavyweight cotton.",
  status: "active",
  activeVersion: "1.2.0",
  updatedAt: 1_767_225_600_000,
};

const variant: ProductVariantDTO = {
  id: "01JQ0000000000000000000001",
  size: "M",
  sku: "FT-M",
  stock: 12,
  mode: "stock",
  expectedShipAt: null,
  available: true,
};

const media: ProductMediaDTO = {
  id: "01JQ0000000000000000000002",
  productId: draft.productId,
  alt: "Front view",
  role: "gallery",
  position: 0,
  href: "/media/01JQ0000000000000000000002",
  contentType: "image/webp",
  size: 84_213,
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};

const order: OrderDetailDTO = {
  orderId: "01JQ0000000000000000000003",
  orderNumber: "SO-ABCD1234",
  sessionId: "cs_test_123",
  customerId: "cus_1",
  email: "buyer@example.com",
  receiptEmail: null,
  status: "paid",
  paymentStatus: "paid",
  subtotalCents: 4_500,
  shippingCents: 1_200,
  taxCents: 741,
  totalCents: 6_441,
  currency: "cad",
  refundedCents: 0,
  shipCountry: "CA",
  shipping: {
    name: "A Buyer",
    line1: "1 Main St",
    city: "Toronto",
    region: "ON",
    postal: "M5V 1A1",
    country: "CA",
  },
  carrier: null,
  trackingNumber: null,
  fulfillmentNote: null,
  shippedAt: null,
  deliveredAt: null,
  createdAt: 1_767_225_600_000,
  items: [
    {
      productId: draft.productId,
      variantId: variant.id,
      preorder: false,
      expectedShipAt: null,
      title: "Field Tee",
      size: "M",
      unitPriceCents: 4_500,
      quantity: 1,
    },
  ],
};

/** Encode then decode, and assert the value survives unchanged. */
const roundTrip = <A, I>(schema: Schema.Codec<A, I>, value: A): A =>
  Schema.decodeSync(schema)(Schema.encodeSync(schema)(value));

describe("domain values survive the RPC boundary", () => {
  test("a product draft", () => {
    expect(roundTrip(Rpc.ProductDraft, draft)).toEqual(draft);
  });

  test("a variant", () => {
    expect(roundTrip(Rpc.ProductVariant, variant)).toEqual(variant);
  });

  test("a media reference", () => {
    expect(roundTrip(Rpc.ProductMedia, media)).toEqual(media);
  });

  test("a full order detail, items and address included", () => {
    expect(roundTrip(Rpc.OrderDetail, order)).toEqual(order);
  });

  test("an order with no address — `shipping` is all-or-nothing", () => {
    const unshipped: OrderDetailDTO = { ...order, shipping: null, status: "pending" };
    expect(roundTrip(Rpc.OrderDetail, unshipped)).toEqual(unshipped);
  });

  test("a product detail assembled from its parts", () => {
    const detail = {
      draft,
      markets: [
        { market: "CA" as const, priceCents: 8_500, active: true },
        { market: "US" as const, priceCents: 7_500, active: false },
      ],
      preorder: { cap: null, claimed: 0, remaining: null },
      releases: [{ id: "rel-1", version: "1.2.0", publishedAt: 1_767_225_600_000 }],
      variants: [variant],
      media: [media],
    };
    expect(roundTrip(Rpc.ProductDetail, detail)).toEqual(detail);
  });

  test("a deletion plan", () => {
    const plan: DeletionPlan = {
      impact: {
        targetType: "product_variant",
        targetId: variant.id,
        label: "Field Tee (M)",
        activeReleaseAffected: false,
        deleteCounts: { product_variant: 1 },
        retainedCounts: { customer_order: 2 },
        warnings: ["2 orders reference this variant and are retained"],
      },
      confirmationToken: "0Zx1-token",
      expiresAt: 1_767_225_600_000 + 600_000,
    };
    expect(roundTrip(Rpc.DeletionPlan, plan)).toEqual(plan);
  });
});

describe("the schema rejects what the domain must never emit", () => {
  const decode = (schema: Schema.Codec<any, any>, value: unknown) => () =>
    Schema.decodeUnknownSync(schema)(value);

  test("an unknown product status", () => {
    expect(decode(Rpc.ProductDraft, { ...draft, status: "retired" })).toThrow();
  });

  test("an unknown media role", () => {
    expect(decode(Rpc.ProductMedia, { ...media, role: "thumbnail" })).toThrow();
  });

  test("a shipping country outside the two supported", () => {
    expect(
      decode(Rpc.OrderDetail, { ...order, shipping: { ...order.shipping, country: "GB" } }),
    ).toThrow();
  });

  test("a missing required field", () => {
    const { title: _title, ...withoutTitle } = draft;
    expect(decode(Rpc.ProductDraft, withoutTitle)).toThrow();
  });

  test("a market outside the two supported", () => {
    expect(decode(Rpc.MarketPrice, { market: "EU", priceCents: 7_500, active: true })).toThrow();
  });

  test("an empty commandId — the one thing the browser supplies toward idempotency", () => {
    expect(decode(Rpc.CommandId, "")).toThrow();
    expect(Schema.decodeUnknownSync(Rpc.CommandId)("c")).toBe("c");
  });
});

describe("the settlement event payload", () => {
  test("a refund event round-trips with its charge detail", () => {
    const event = {
      id: "evt_1",
      type: "charge.refunded",
      sessionId: null,
      paymentStatus: null,
      orderId: null,
      livemode: false,
      email: null,
      shipping: null,
      shipCountry: null,
      amounts: null,
      paymentIntentId: "pi_1",
      refund: { amountRefundedCents: 1_000, chargeAmountCents: 6_441, fullyRefunded: false },
    };
    expect(roundTrip(Rpc.ProviderEventPayload, event)).toEqual(event);
  });

  test("an unknown payment status is rejected", () => {
    expect(() =>
      Schema.decodeUnknownSync(Rpc.ProviderEventPayload)({
        id: "evt_1",
        type: "checkout.session.completed",
        sessionId: "cs_1",
        paymentStatus: "pending",
        orderId: null,
        livemode: false,
        email: null,
        shipping: null,
        shipCountry: null,
        amounts: null,
        paymentIntentId: null,
        refund: null,
      }),
    ).toThrow();
  });
});
