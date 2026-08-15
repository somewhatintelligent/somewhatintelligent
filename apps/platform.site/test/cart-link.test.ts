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
import {
  CART_PARAM,
  parseCartParam,
  serializeCart,
  takeCartParam,
  writeCartParam,
} from "../src/core/cart-link.ts";

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

/**
 * The URL half. Both ends of the feature go through these, which is the point
 * — the reader and the writer used to spell the same thing two ways.
 */
describe("writeCartParam", () => {
  test("puts the cart on the URL", () => {
    const url = new URL("https://shop.example/cart/");
    writeCartParam(url, [{ variantId: "v", quantity: 2 }]);
    expect(url.searchParams.get(CART_PARAM)).toBe("v:2");
  });

  test("an empty cart takes the parameter off rather than writing nothing", () => {
    const url = new URL("https://shop.example/cart/?cart=v%3A2&keep=1");
    writeCartParam(url, []);
    expect(url.searchParams.has(CART_PARAM)).toBe(false);
    expect(url.searchParams.get("keep")).toBe("1");
  });

  test("leaves the rest of the URL alone", () => {
    const url = new URL("https://shop.example/cart/?keep=1#frag");
    writeCartParam(url, [{ variantId: "v", quantity: 1 }]);
    expect(url.pathname).toBe("/cart/");
    expect(url.hash).toBe("#frag");
    expect(url.searchParams.get("keep")).toBe("1");
  });
});

describe("takeCartParam", () => {
  test("reads the cart and strips the parameter", () => {
    const url = new URL("https://shop.example/cart/?cart=v%3A2&keep=1");
    expect(takeCartParam(url)).toEqual([{ variantId: "v", quantity: 2 }]);
    expect(url.searchParams.has(CART_PARAM)).toBe(false);
    expect(url.searchParams.get("keep")).toBe("1");
  });

  test("null when the URL carried nothing — distinct from carrying nothing usable", () => {
    expect(takeCartParam(new URL("https://shop.example/cart/"))).toBeNull();
    expect(takeCartParam(new URL("https://shop.example/cart/?cart=%%%"))).toEqual([]);
  });

  test("a hash survives the strip", () => {
    const url = new URL("https://shop.example/cart/?cart=v%3A1#frag");
    takeCartParam(url);
    expect(url.toString()).toBe("https://shop.example/cart/#frag");
  });

  test("round-trips against writeCartParam", () => {
    const lines = [
      { variantId: "a", quantity: 2 },
      { variantId: "b", quantity: 1 },
    ];
    const url = new URL("https://shop.example/cart/");
    writeCartParam(url, lines);
    expect(takeCartParam(url)).toEqual(lines);
  });
});
