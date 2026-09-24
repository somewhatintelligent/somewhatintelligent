/**
 * The rules for an order paid elsewhere, without a database.
 *
 * The RPC schema already refuses most of these shapes at the edge. They are
 * re-checked here because the binding is typed, not decoded: a bound caller
 * reaches the core without passing through `Rpc.ts`, and a negative price that
 * slipped through would be a refund nobody issued.
 */
import { describe, expect, test } from "bun:test";

import {
  normaliseAddress,
  normaliseEmail,
  normalisePayment,
  priceExternalOrder,
  type ExternalProduct,
  type ExternalVariant,
} from "../../core/external-order.ts";

const TEE: ExternalProduct = { id: "prod-tee", title: "Tee", preorderCap: null };
const RUN: ExternalProduct = { id: "prod-run", title: "Jacket", preorderCap: 20 };

const medium: ExternalVariant = {
  id: "var-m",
  productId: "prod-tee",
  size: "M",
  stock: 5,
  mode: "stock",
  expectedShipAt: null,
};

const preorderM: ExternalVariant = {
  id: "var-pre-m",
  productId: "prod-run",
  size: "M",
  stock: 20,
  mode: "preorder",
  expectedShipAt: 1_800_000_000_000,
};

const price = (
  items: { variantId: string; quantity: number; unitPriceCents: number }[],
  amounts: { shippingCents?: number; taxCents?: number } = {},
) =>
  priceExternalOrder(
    { items, shippingCents: amounts.shippingCents ?? 0, taxCents: amounts.taxCents ?? 0 },
    [medium, preorderM],
    [TEE, RUN],
  );

describe("totals", () => {
  test("the total is the sum of what was charged — never an input", () => {
    const totals = price(
      [
        { variantId: "var-m", quantity: 2, unitPriceCents: 4_000 },
        { variantId: "var-pre-m", quantity: 1, unitPriceCents: 30_000 },
      ],
      { shippingCents: 1_500, taxCents: 4_940 },
    );
    expect(totals).toMatchObject({
      ok: true,
      subtotalCents: 38_000,
      shippingCents: 1_500,
      taxCents: 4_940,
      totalCents: 44_440,
    });
  });

  test("lines snapshot the operator's price and the variant's mode", () => {
    const totals = price([{ variantId: "var-pre-m", quantity: 1, unitPriceCents: 0 }]);
    if (!totals.ok) throw new Error(totals.error);
    expect(totals.lines).toEqual([
      {
        variantId: "var-pre-m",
        productId: "prod-run",
        title: "Jacket",
        size: "M",
        // A gift is a sale at zero, and still takes a place in the run.
        unitPriceCents: 0,
        quantity: 1,
        preorder: true,
        expectedShipAt: 1_800_000_000_000,
      },
    ]);
  });
});

describe("refusals", () => {
  test("an empty order", () => {
    expect(price([])).toEqual({ ok: false, error: "empty_order" });
  });

  test.each([0, -1, 1.5])("a quantity of %p, named by the line it is on", (quantity) => {
    expect(price([{ variantId: "var-m", quantity, unitPriceCents: 4_500 }])).toEqual({
      ok: false,
      error: "invalid_quantity",
      message: "Tee (M)",
    });
  });

  test.each([-1, 45.5, Number.NaN])(
    "a unit price of %p, named by the line it is on",
    (unitPriceCents) => {
      expect(price([{ variantId: "var-m", quantity: 1, unitPriceCents }])).toEqual({
        ok: false,
        error: "invalid_amount",
        message: "Tee (M)",
      });
    },
  );

  test("a variant that does not exist", () => {
    expect(price([{ variantId: "gone", quantity: 1, unitPriceCents: 4_500 }])).toEqual({
      ok: false,
      error: "variant_not_found",
      message: "gone",
    });
  });

  test("negative or fractional shipping and tax", () => {
    const line = [{ variantId: "var-m", quantity: 1, unitPriceCents: 4_500 }];
    expect(price(line, { shippingCents: -100 })).toEqual({
      ok: false,
      error: "invalid_amount",
      message: "shipping",
    });
    expect(price(line, { taxCents: 0.5 })).toEqual({
      ok: false,
      error: "invalid_amount",
      message: "tax",
    });
  });

  test("more than the shelf or the run holds", () => {
    expect(price([{ variantId: "var-m", quantity: 6, unitPriceCents: 4_500 }])).toEqual({
      ok: false,
      error: "out_of_stock",
      message: "Tee (M)",
    });
    expect(price([{ variantId: "var-pre-m", quantity: 21, unitPriceCents: 30_000 }])).toEqual({
      ok: false,
      error: "preorder_full",
      message: "Jacket (M)",
    });
  });

  test("a pre-order under a product whose run was never opened", () => {
    expect(
      priceExternalOrder(
        {
          items: [{ variantId: "var-pre-m", quantity: 1, unitPriceCents: 30_000 }],
          shippingCents: 0,
          taxCents: 0,
        },
        [preorderM],
        [{ ...RUN, preorderCap: null }],
      ),
    ).toEqual({ ok: false, error: "preorder_cap_missing", message: "Jacket" });
  });
});

describe("hand-typed fields", () => {
  test("an email is filed the way checkout files it", () => {
    expect(normaliseEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normaliseEmail("ada@")).toBeNull();
    expect(normaliseEmail("ada example.com")).toBeNull();
  });

  test("an address is trimmed, and blank optional lines are dropped", () => {
    expect(
      normaliseAddress({
        name: " Ada ",
        line1: "1 Main St ",
        line2: "  ",
        city: "Toronto",
        region: "ON",
        postal: " M5V 1A1",
        country: "CA",
        phone: "",
      }),
    ).toEqual({
      name: "Ada",
      line1: "1 Main St",
      city: "Toronto",
      region: "ON",
      postal: "M5V 1A1",
      country: "CA",
    });
  });

  test("an address with a blank line a label needs is refused", () => {
    expect(
      normaliseAddress({
        name: "Ada",
        line1: "1 Main St",
        city: "Toronto",
        region: " ",
        postal: "M5V 1A1",
        country: "CA",
      }),
    ).toBeNull();
  });

  test("a payment needs a method; a reference is optional", () => {
    expect(normalisePayment({ method: " cash ", reference: "  " })).toEqual({
      method: "cash",
      reference: null,
    });
    expect(normalisePayment({ method: "e-transfer", reference: " CA7Q2M" })).toEqual({
      method: "e-transfer",
      reference: "CA7Q2M",
    });
    expect(normalisePayment({ method: "   " })).toBeNull();
  });
});
