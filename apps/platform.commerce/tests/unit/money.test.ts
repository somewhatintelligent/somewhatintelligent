/**
 * Money representation and size ordering.
 *
 * The invariant `Money.ts` exists to protect is that money is only ever added
 * and multiplied by integer quantities — never divided — so these tests pin the
 * integer guard rather than any arithmetic helper, because there is deliberately
 * no arithmetic helper to test.
 */
import { describe, expect, test } from "bun:test";

import {
  FREE_SHIPPING_THRESHOLD_CENTS,
  isNonNegativeInt,
  qualifiesForFreeShipping,
  SIZE_ORDER,
  sortBySize,
} from "../../core/money.ts";

describe("isNonNegativeInt", () => {
  test("accepts zero and positive integers", () => {
    expect(isNonNegativeInt(0)).toBe(true);
    expect(isNonNegativeInt(1)).toBe(true);
    expect(isNonNegativeInt(9_999_99)).toBe(true);
  });

  test("rejects negatives", () => {
    expect(isNonNegativeInt(-1)).toBe(false);
  });

  test("rejects fractions — a price in minor units is never fractional", () => {
    expect(isNonNegativeInt(10.5)).toBe(false);
    expect(isNonNegativeInt(0.1)).toBe(false);
  });

  test("rejects non-finite values", () => {
    expect(isNonNegativeInt(Number.NaN)).toBe(false);
    expect(isNonNegativeInt(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("free shipping", () => {
  test("the threshold is inclusive", () => {
    expect(qualifiesForFreeShipping(FREE_SHIPPING_THRESHOLD_CENTS)).toBe(true);
  });

  test("one cent short does not qualify", () => {
    expect(qualifiesForFreeShipping(FREE_SHIPPING_THRESHOLD_CENTS - 1)).toBe(false);
  });

  test("an empty cart does not qualify", () => {
    expect(qualifiesForFreeShipping(0)).toBe(false);
  });
});

describe("sortBySize", () => {
  test("orders by the garment scale, not alphabetically", () => {
    const sorted = sortBySize([
      { size: "XL" },
      { size: "XS" },
      { size: "L" },
      { size: "S" },
      { size: "M" },
    ]);
    expect(sorted.map((row) => row.size)).toEqual(["XS", "S", "M", "L", "XL"]);
  });

  test("keeps the full declared scale in order", () => {
    const shuffled = [...SIZE_ORDER].reverse().map((size) => ({ size }));
    expect(sortBySize(shuffled).map((row) => row.size)).toEqual([...SIZE_ORDER]);
  });

  test("sizes outside the scale sort after every known size", () => {
    const sorted = sortBySize([{ size: "ONE SIZE" }, { size: "M" }, { size: "XS" }]);
    expect(sorted.map((row) => row.size)).toEqual(["XS", "M", "ONE SIZE"]);
  });

  test("does not mutate the caller's array", () => {
    const source = [{ size: "XL" }, { size: "XS" }];
    sortBySize(source);
    expect(source.map((row) => row.size)).toEqual(["XL", "XS"]);
  });

  /**
   * DOCUMENTED MISMATCH. The module's comment claims sizes sort "not
   * lexicographically — `10` before `9`", but the fallback for anything outside
   * SIZE_ORDER is exactly `localeCompare`. It happens to place "10" before "9",
   * and happens to place "11" before "9" too, which numeric ordering would not.
   *
   * Pinned as-is so the behaviour is visible rather than assumed; the comment is
   * what needs correcting, not this.
   */
  test("unknown sizes fall back to lexicographic order", () => {
    const sorted = sortBySize([{ size: "9" }, { size: "11" }, { size: "10" }]);
    expect(sorted.map((row) => row.size)).toEqual(["10", "11", "9"]);
  });
});
