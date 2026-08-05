/**
 * Cart pricing rules.
 *
 * These are the rules that decide what a buyer is charged, and until now the
 * only way to exercise one was to deploy a stack and place an order. Every case
 * below is a rule `Reservations.ts` states in prose.
 */
import { describe, expect, test } from "bun:test";

import {
  computeTotals,
  runClaims,
  type CartItem,
  type PricingProduct,
  type PricingVariant,
} from "../../core/pricing.ts";

const TEE: PricingProduct = {
  id: "prod-tee",
  title: "Tee",
  priceCents: 4_500,
  status: "active",
  preorderCap: null,
  preorderClaimed: 0,
};

const RUN: PricingProduct = {
  id: "prod-run",
  title: "Jacket",
  priceCents: 32_000,
  status: "active",
  preorderCap: 200,
  preorderClaimed: 10,
};

const medium: PricingVariant = {
  id: "var-m",
  productId: "prod-tee",
  size: "M",
  stock: 5,
  mode: "stock",
  expectedShipAt: null,
};

const large: PricingVariant = {
  id: "var-l",
  productId: "prod-tee",
  size: "L",
  stock: 2,
  mode: "stock",
  expectedShipAt: null,
};

const preorderM: PricingVariant = {
  id: "var-pre-m",
  productId: "prod-run",
  size: "M",
  stock: 40,
  mode: "preorder",
  expectedShipAt: 1_800_000_000_000,
};

const preorderL: PricingVariant = {
  id: "var-pre-l",
  productId: "prod-run",
  size: "L",
  stock: 30,
  mode: "preorder",
  expectedShipAt: 1_800_000_000_000,
};

const cart = (...items: CartItem[]) => items;

describe("computeTotals — refusals", () => {
  test("an empty cart is refused", () => {
    const result = computeTotals([], [medium], [TEE]);
    expect(result).toEqual({ ok: false, error: "empty_cart" });
  });

  test("a zero or negative quantity is refused", () => {
    for (const quantity of [0, -1]) {
      const result = computeTotals(cart({ variantId: "var-m", quantity }), [medium], [TEE]);
      expect(result).toMatchObject({ ok: false, error: "invalid_quantity" });
    }
  });

  test("a fractional quantity is refused — you cannot buy half a shirt", () => {
    const result = computeTotals(cart({ variantId: "var-m", quantity: 1.5 }), [medium], [TEE]);
    expect(result).toMatchObject({ ok: false, error: "invalid_quantity" });
  });

  test("an unknown variant is refused", () => {
    const result = computeTotals(cart({ variantId: "nope", quantity: 1 }), [medium], [TEE]);
    expect(result).toMatchObject({ ok: false, error: "variant_not_found", message: "nope" });
  });

  test("a non-active product is refused", () => {
    for (const status of ["draft", "unavailable", "archived"]) {
      const result = computeTotals(
        cart({ variantId: "var-m", quantity: 1 }),
        [medium],
        [{ ...TEE, status }],
      );
      expect(result).toMatchObject({ ok: false, error: "product_unavailable" });
    }
  });

  /**
   * The pricing query INNER JOINs through the active release, so a product with
   * no active release contributes no row at all. That has to FAIL CLOSED rather
   * than price from the draft.
   */
  test("a variant whose product has no pricing row fails closed", () => {
    const result = computeTotals(cart({ variantId: "var-m", quantity: 1 }), [medium], []);
    expect(result).toMatchObject({ ok: false, error: "product_unavailable" });
  });

  test("a stocked variant short of stock reports out_of_stock, naming the size", () => {
    const result = computeTotals(cart({ variantId: "var-l", quantity: 3 }), [large], [TEE]);
    expect(result).toMatchObject({ ok: false, error: "out_of_stock", message: "Tee (L)" });
  });

  /**
   * ONE CHECK, TWO MESSAGES. `stock` means shelf units for a stocked variant and
   * remaining places for a pre-order; running out means the same thing, but a
   * buyer should not be told a pre-order is "out of stock" — that describes
   * inventory which never existed.
   */
  test("a pre-order variant short of places reports preorder_full", () => {
    const result = computeTotals(
      cart({ variantId: "var-pre-m", quantity: 41 }),
      [preorderM],
      [RUN],
    );
    expect(result).toMatchObject({ ok: false, error: "preorder_full", message: "Jacket (M)" });
  });

  test("the first refusal wins — nothing partial is returned", () => {
    const result = computeTotals(
      cart({ variantId: "var-m", quantity: 1 }, { variantId: "nope", quantity: 1 }),
      [medium],
      [TEE],
    );
    expect(result.ok).toBe(false);
  });
});

describe("computeTotals — pricing", () => {
  test("exactly available stock is allowed", () => {
    const result = computeTotals(cart({ variantId: "var-l", quantity: 2 }), [large], [TEE]);
    expect(result.ok).toBe(true);
  });

  test("the price comes from the PRODUCT's active release, never the variant", () => {
    const result = computeTotals(cart({ variantId: "var-m", quantity: 1 }), [medium], [TEE]);
    if (!result.ok) throw new Error("expected ok");
    expect(result.lines[0]?.unitPriceCents).toBe(4_500);
  });

  test("a product with no price in the buyer's market refuses as market_unavailable", () => {
    const elsewhere: PricingProduct = { ...TEE, priceCents: null };
    const result = computeTotals(cart({ variantId: "var-m", quantity: 1 }), [medium], [elsewhere]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.error).toBe("market_unavailable");
    // The title, not the id: this refusal is rendered to a shopper.
    expect(result.message).toBe("Tee");
  });

  test("subtotal is price times quantity, summed", () => {
    const result = computeTotals(
      cart({ variantId: "var-m", quantity: 2 }, { variantId: "var-l", quantity: 1 }),
      [medium, large],
      [TEE],
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.subtotalCents).toBe(4_500 * 2 + 4_500);
  });

  test("subtotal stays an integer — money is never divided here", () => {
    const result = computeTotals(
      cart({ variantId: "var-m", quantity: 3 }, { variantId: "var-pre-m", quantity: 2 }),
      [medium, preorderM],
      [TEE, RUN],
    );
    if (!result.ok) throw new Error("expected ok");
    expect(Number.isInteger(result.subtotalCents)).toBe(true);
  });

  test("the preorder flag is SNAPSHOT from the variant's mode", () => {
    const result = computeTotals(
      cart({ variantId: "var-m", quantity: 1 }, { variantId: "var-pre-m", quantity: 1 }),
      [medium, preorderM],
      [TEE, RUN],
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.lines.map((line) => line.preorder)).toEqual([false, true]);
  });

  test("expectedShipAt is carried onto the line", () => {
    const result = computeTotals(cart({ variantId: "var-pre-m", quantity: 1 }), [preorderM], [RUN]);
    if (!result.ok) throw new Error("expected ok");
    expect(result.lines[0]?.expectedShipAt).toBe(1_800_000_000_000);
  });

  test("line order follows cart order", () => {
    const result = computeTotals(
      cart({ variantId: "var-l", quantity: 1 }, { variantId: "var-m", quantity: 1 }),
      [medium, large],
      [TEE],
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.lines.map((line) => line.variantId)).toEqual(["var-l", "var-m"]);
  });
});

describe("runClaims", () => {
  const line = (productId: string, quantity: number, preorder: boolean, title = "x") => ({
    productId,
    title,
    quantity,
    preorder,
  });

  test("a cart with no pre-orders claims nothing", () => {
    expect(runClaims([line("prod-tee", 2, false)])).toEqual([]);
  });

  /**
   * THE WHOLE REASON THE CAP LIVES ON THE PRODUCT. Two sizes of one jacket take
   * two variant guards but exactly ONE run guard — the run makes N garments
   * however the sizes fall, so guarding twice would double-count the claim.
   */
  test("two sizes of one product aggregate into a single claim", () => {
    const claims = runClaims([
      line("prod-run", 2, true, "Jacket"),
      line("prod-run", 3, true, "Jacket"),
    ]);
    expect(claims).toEqual([{ productId: "prod-run", title: "Jacket", quantity: 5 }]);
  });

  test("two products claim separately", () => {
    const claims = runClaims([line("prod-a", 1, true), line("prod-b", 2, true)]);
    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.quantity)).toEqual([1, 2]);
  });

  test("non-preorder lines are excluded from the aggregate", () => {
    const claims = runClaims([line("prod-run", 2, true), line("prod-run", 99, false)]);
    expect(claims).toEqual([{ productId: "prod-run", title: "x", quantity: 2 }]);
  });

  test("claims align with what computeTotals produced", () => {
    const result = computeTotals(
      cart(
        { variantId: "var-pre-m", quantity: 2 },
        { variantId: "var-pre-l", quantity: 3 },
        { variantId: "var-m", quantity: 1 },
      ),
      [preorderM, preorderL, medium],
      [RUN, TEE],
    );
    if (!result.ok) throw new Error("expected ok");
    expect(runClaims(result.lines)).toEqual([
      { productId: "prod-run", title: "Jacket", quantity: 5 },
    ]);
  });
});
