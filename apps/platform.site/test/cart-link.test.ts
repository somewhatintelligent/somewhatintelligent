/**
 * The escape hatch's luggage, tested at a desk.
 *
 * What travels in the link is the same two fields storage holds, so the
 * properties under test are the link's own: a round trip is lossless, garbage
 * is an empty cart rather than a throw, and an import fills gaps without
 * touching a line the shopper already holds.
 */
import { describe, expect, test } from "bun:test";

import { MAX_QUANTITY } from "../src/core/cart.ts";
import { mergeImported, parseCartParam, serializeCart } from "../src/core/cart-link.ts";

describe("serializeCart / parseCartParam", () => {
  test("round-trips a cart", () => {
    const lines = [
      { variantId: "var_a", quantity: 2 },
      { variantId: "var_b", quantity: 1 },
    ];
    expect(parseCartParam(serializeCart(lines))).toEqual(lines);
  });

  test("an empty cart is an empty string, and back", () => {
    expect(serializeCart([])).toBe("");
    expect(parseCartParam("")).toEqual([]);
  });

  test("delimiters inside a variant id survive the trip", () => {
    const lines = [{ variantId: "odd:id,with-both", quantity: 3 }];
    expect(parseCartParam(serializeCart(lines))).toEqual(lines);
  });

  test("garbage is an empty cart, never a throw", () => {
    expect(parseCartParam("%%%")).toEqual([]);
    expect(parseCartParam(",,,")).toEqual([]);
    expect(parseCartParam(":5")).toEqual([]);
  });

  test("one mangled line drops without voiding the rest", () => {
    expect(parseCartParam("%%%:2,ok:2")).toEqual([{ variantId: "ok", quantity: 2 }]);
  });

  test("clamps what the link claims, exactly as storage would", () => {
    expect(parseCartParam("v:999")).toEqual([{ variantId: "v", quantity: MAX_QUANTITY }]);
    expect(parseCartParam("v:nonsense")).toEqual([{ variantId: "v", quantity: 1 }]);
    expect(parseCartParam("v:2,v:3")).toEqual([{ variantId: "v", quantity: 5 }]);
  });
});

describe("mergeImported", () => {
  test("fills only the gaps", () => {
    const current = [{ variantId: "held", quantity: 1 }];
    const imported = [
      { variantId: "held", quantity: 9 },
      { variantId: "new", quantity: 2 },
    ];
    expect(mergeImported(current, imported)).toEqual([
      { variantId: "held", quantity: 1 },
      { variantId: "new", quantity: 2 },
    ]);
  });

  test("an empty link changes nothing", () => {
    const current = [{ variantId: "held", quantity: 4 }];
    expect(mergeImported(current, [])).toEqual(current);
  });

  test("does not mutate its arguments", () => {
    const current = [{ variantId: "a", quantity: 1 }];
    const imported = [{ variantId: "b", quantity: 1 }];
    mergeImported(current, imported);
    expect(current).toEqual([{ variantId: "a", quantity: 1 }]);
    expect(imported).toEqual([{ variantId: "b", quantity: 1 }]);
  });
});
