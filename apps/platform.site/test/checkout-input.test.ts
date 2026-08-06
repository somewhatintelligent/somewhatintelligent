/**
 * The rules a checkout body has to satisfy — the guard in front of the one
 * write path this site exposes, so its refusals are worth stating exactly.
 *
 * Every case here is a request someone can actually send: a hand-edited cart, a
 * resubmitted form, a body with the wrong shape entirely.
 */
import { describe, expect, test } from "bun:test";

import { parseCheckout, parseOrderLookup } from "../src/core/checkout-input.ts";

const good = {
  email: "Buyer@Example.com",
  market: "CA",
  commandId: "01234567-89ab-cdef-0123-456789abcdef",
  items: [{ variantId: "v1", quantity: 2 }],
};

describe("parseCheckout", () => {
  test("accepts a well-formed body and normalises the address", () => {
    const parsed = parseCheckout(good);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Lower-cased and trimmed, because the order is keyed on that form — a
    // buyer who capitalises their address must reach the same order later.
    expect(parsed.value.email).toBe("buyer@example.com");
    expect(parsed.value.items).toEqual([{ variantId: "v1", quantity: 2 }]);
  });

  test("a missing or malformed body is refused, not thrown on", () => {
    expect(parseCheckout(null).ok).toBe(false);
    expect(parseCheckout(undefined).ok).toBe(false);
    expect(parseCheckout("nope").ok).toBe(false);
  });

  test("names the field that failed", () => {
    expect(parseCheckout({ ...good, email: "x" })).toMatchObject({ error: "invalid_email" });
    expect(parseCheckout({ ...good, market: "MX" })).toMatchObject({
      error: "invalid_market",
    });
    expect(parseCheckout({ ...good, commandId: "short" })).toMatchObject({
      error: "invalid_command_id",
    });
    expect(parseCheckout({ ...good, items: [] })).toMatchObject({ error: "invalid_cart" });
  });

  test("an over-long address is refused — it is persisted twice per order", () => {
    const email = `${"a".repeat(250)}@example.com`;
    expect(parseCheckout({ ...good, email })).toMatchObject({ error: "invalid_email" });
  });

  test("only the two markets the shop actually sells in", () => {
    expect(parseCheckout({ ...good, market: "US" }).ok).toBe(true);
    // Exact match, not a case-insensitive one — the market is a constant the
    // catalogue is priced in, not free text the buyer types.
    expect(parseCheckout({ ...good, market: "ca" }).ok).toBe(false);
  });

  test("a cart above the line cap is refused here rather than 500ing in D1", () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 }));
    expect(parseCheckout({ ...good, items })).toMatchObject({ error: "invalid_cart" });
  });

  test("ONE bad line refuses the whole cart", () => {
    const items = [
      { variantId: "v1", quantity: 1 },
      { variantId: "", quantity: 1 },
    ];
    expect(parseCheckout({ ...good, items })).toMatchObject({ error: "invalid_cart" });
  });

  test("quantities outside the range are refused rather than clamped", () => {
    // Clamping would silently sell a different number of things than asked for.
    expect(parseCheckout({ ...good, items: [{ variantId: "v", quantity: 0 }] }).ok).toBe(false);
    expect(parseCheckout({ ...good, items: [{ variantId: "v", quantity: 11 }] }).ok).toBe(false);
    expect(parseCheckout({ ...good, items: [{ variantId: "v", quantity: "2" }] }).ok).toBe(true);
  });

  test("items must be an array, not an object that looks like one", () => {
    expect(parseCheckout({ ...good, items: { 0: { variantId: "v", quantity: 1 } } }).ok).toBe(
      false,
    );
  });
});

describe("parseOrderLookup", () => {
  test("needs both a number and an address", () => {
    expect(parseOrderLookup({ orderNumber: "SI-1", email: "b@example.com" })).toEqual({
      orderNumber: "SI-1",
      email: "b@example.com",
    });
    expect(parseOrderLookup({ orderNumber: "SI-1" })).toBeNull();
    expect(parseOrderLookup({ email: "b@example.com" })).toBeNull();
    expect(parseOrderLookup({ orderNumber: "", email: "b@example.com" })).toBeNull();
  });

  test("the address is normalised the same way it was at checkout", () => {
    expect(parseOrderLookup({ orderNumber: "SI-1", email: " B@Example.com " })?.email).toBe(
      "b@example.com",
    );
  });
});
