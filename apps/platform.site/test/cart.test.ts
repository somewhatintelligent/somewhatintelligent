/**
 * The cart's arithmetic, tested without a browser — which is the whole reason
 * it was split out of `lib/cart.ts`.
 *
 * The bounds under test are not cosmetic: `MAX_LINES` mirrors `placeOrder`'s
 * payload cap, itself set by D1's hundred-bound-parameter limit, so a cart that
 * exceeds it is a 500 on a public endpoint rather than a refusal.
 */
import { describe, expect, test } from "bun:test";

import {
  MAX_LINES,
  MAX_QUANTITY,
  MIN_QUANTITY,
  clampQuantity,
  countUnits,
  normalize,
  normalizeHints,
  withLine,
  withQuantity,
  withoutLine,
} from "../src/core/cart.ts";

describe("clampQuantity", () => {
  test("holds the range", () => {
    expect(clampQuantity(0)).toBe(MIN_QUANTITY);
    expect(clampQuantity(999)).toBe(MAX_QUANTITY);
    expect(clampQuantity(3)).toBe(3);
  });

  test("a non-number is the minimum rather than NaN", () => {
    expect(clampQuantity("nonsense")).toBe(MIN_QUANTITY);
    expect(clampQuantity(undefined)).toBe(MIN_QUANTITY);
    expect(clampQuantity(Number.POSITIVE_INFINITY)).toBe(MIN_QUANTITY);
  });

  test("truncates rather than rounds, so 1.9 cannot become 2", () => {
    expect(clampQuantity(1.9)).toBe(1);
  });
});

describe("normalize", () => {
  test("anything that is not an array is an empty cart", () => {
    expect(normalize(null)).toEqual([]);
    expect(normalize("[]")).toEqual([]);
    expect(normalize({ variantId: "v" })).toEqual([]);
  });

  test("drops entries that are not lines", () => {
    expect(normalize([null, 7, { quantity: 2 }, { variantId: "" }])).toEqual([]);
  });

  test("folds a duplicated variant into one line", () => {
    expect(
      normalize([
        { variantId: "v", quantity: 2 },
        { variantId: "v", quantity: 3 },
      ]),
    ).toEqual([{ variantId: "v", quantity: 5 }]);
  });

  test("a fold still clamps, so two big lines cannot exceed the max", () => {
    expect(
      normalize([
        { variantId: "v", quantity: 9 },
        { variantId: "v", quantity: 9 },
      ]),
    ).toEqual([{ variantId: "v", quantity: MAX_QUANTITY }]);
  });

  test("caps the number of lines", () => {
    const many = Array.from({ length: MAX_LINES + 5 }, (_, i) => ({
      variantId: `v${i}`,
      quantity: 1,
    }));
    expect(normalize(many)).toHaveLength(MAX_LINES);
  });
});

describe("withLine", () => {
  test("adds a variant the cart does not hold", () => {
    expect(withLine([], "v", 2)).toEqual([{ variantId: "v", quantity: 2 }]);
  });

  test("sums into a variant already held", () => {
    expect(withLine([{ variantId: "v", quantity: 1 }], "v", 2)).toEqual([
      { variantId: "v", quantity: 3 },
    ]);
  });

  test("an empty id is ignored rather than stored", () => {
    expect(withLine([], "", 1)).toEqual([]);
  });

  test("a full cart still accepts more of what it holds", () => {
    const full = Array.from({ length: MAX_LINES }, (_, i) => ({
      variantId: `v${i}`,
      quantity: 1,
    }));
    expect(withLine(full, "new", 1)).toHaveLength(MAX_LINES);
    expect(withLine(full, "v0", 1)[0]).toEqual({ variantId: "v0", quantity: 2 });
  });

  test("does not mutate its argument", () => {
    const lines = [{ variantId: "v", quantity: 1 }];
    withLine(lines, "v", 1);
    expect(lines[0]?.quantity).toBe(1);
  });
});

describe("withQuantity and withoutLine", () => {
  test("sets an absolute quantity, clamped", () => {
    expect(withQuantity([{ variantId: "v", quantity: 1 }], "v", 99)).toEqual([
      { variantId: "v", quantity: MAX_QUANTITY },
    ]);
  });

  test("a quantity for an absent variant changes nothing", () => {
    expect(withQuantity([{ variantId: "v", quantity: 1 }], "other", 5)).toEqual([
      { variantId: "v", quantity: 1 },
    ]);
  });

  test("removes a line", () => {
    expect(withoutLine([{ variantId: "v", quantity: 1 }], "v")).toEqual([]);
  });
});

describe("countUnits", () => {
  test("sums quantities, not lines", () => {
    expect(
      countUnits([
        { variantId: "a", quantity: 2 },
        { variantId: "b", quantity: 3 },
      ]),
    ).toBe(5);
  });
});

describe("normalizeHints", () => {
  test("an array is not a hints record", () => {
    expect(normalizeHints([])).toEqual({});
    expect(normalizeHints(null)).toEqual({});
    expect(normalizeHints("x")).toEqual({});
  });

  test("an object passes through", () => {
    const hints = {
      v: { slug: "s", title: "t", size: "M", priceCents: 1, currency: "cad", coverHref: null },
    };
    expect(normalizeHints(hints)).toEqual(hints);
  });
});
