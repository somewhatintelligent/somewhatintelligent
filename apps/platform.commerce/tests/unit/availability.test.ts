/**
 * WHAT THE SHOP MAY ADVERTISE.
 *
 * The property under test is one sentence: **if a size is shown as available,
 * a checkout for it must survive both reservation guards.** It used to be
 * `stock > 0` in two separate queries, neither of which looked at the run — so
 * a fully-subscribed run advertised every size as buyable and then refused at
 * Buy, and both the storefront contract and the console asserted the opposite.
 *
 * These cases are written against the guards in `Reservations.ts` rather than
 * against the previous behaviour: a sale must pass the per-variant decrement,
 * and a pre-order line must additionally pass the run claim, which itself
 * requires the cap to exist.
 */
import { describe, expect, test } from "bun:test";

import { isAvailable, type AvailabilityInputs } from "../../core/availability.ts";

const shelf = (over: Partial<AvailabilityInputs> = {}): AvailabilityInputs => ({
  stock: 10,
  mode: "stock",
  runCap: null,
  runClaimed: 0,
  ...over,
});

const run = (over: Partial<AvailabilityInputs> = {}): AvailabilityInputs => ({
  stock: 10,
  mode: "preorder",
  runCap: 50,
  runClaimed: 0,
  ...over,
});

describe("shelf stock", () => {
  test("available while units remain", () => {
    expect(isAvailable(shelf({ stock: 1 }))).toBe(true);
  });

  test("unavailable at zero", () => {
    expect(isAvailable(shelf({ stock: 0 }))).toBe(false);
  });

  test("the run is irrelevant — a stocked line never claims against it", () => {
    // `runClaims` emits a claim only for lines marked preorder, so the run
    // guard is not in a stocked line's path at all. A full run beside a stocked
    // variant must not hide it.
    expect(isAvailable(shelf({ runCap: 50, runClaimed: 50 }))).toBe(true);
  });
});

describe("pre-order against a run", () => {
  test("available while the run has places and the size has units", () => {
    expect(isAvailable(run({ runClaimed: 49 }))).toBe(true);
  });

  test("THE REGRESSION — a full run hides every size, however much stock remains", () => {
    // This is the shape the operator actually sells: per-size stock set to the
    // run size so only the aggregate binds. Every size reads 50 while the run
    // has nothing left.
    expect(isAvailable(run({ stock: 50, runCap: 50, runClaimed: 50 }))).toBe(false);
  });

  test("an over-subscribed run is closed, not merely full", () => {
    expect(isAvailable(run({ runClaimed: 51 }))).toBe(false);
  });

  test("a size that ran out is unavailable even with places left in the run", () => {
    expect(isAvailable(run({ stock: 0, runClaimed: 0 }))).toBe(false);
  });

  test("no cap means unbuyable, because the run guard requires one", () => {
    // `runGuardStatement` matches zero rows when `preorder_cap IS NULL`, so
    // every checkout fails `preorder_full` forever. Advertising it would be the
    // lie; `setProductStatus` refuses to let a live product reach this shape.
    expect(isAvailable(run({ runCap: null }))).toBe(false);
  });

  test("a cap of zero is a run that sells nothing", () => {
    expect(isAvailable(run({ runCap: 0, runClaimed: 0 }))).toBe(false);
  });
});

describe("the invariant, exhaustively over small values", () => {
  /**
   * The guards, restated independently of the function under test. If these two
   * ever disagree with `isAvailable`, the storefront is advertising something
   * checkout will refuse — which is exactly the defect this file exists for.
   */
  const survivesBothGuards = ({ stock, mode, runCap, runClaimed }: AvailabilityInputs): boolean => {
    const variantGuard = stock >= 1;
    if (mode !== "preorder") return variantGuard;
    const runGuard = runCap !== null && runClaimed + 1 <= runCap;
    return variantGuard && runGuard;
  };

  test("advertised implies purchasable, for every combination in range", () => {
    const caps: Array<number | null> = [null, 0, 1, 3];
    for (const mode of ["stock", "preorder"]) {
      for (const stock of [0, 1, 2, 5]) {
        for (const runCap of caps) {
          for (const runClaimed of [0, 1, 3, 4]) {
            const inputs = { stock, mode, runCap, runClaimed };
            expect({ ...inputs, available: isAvailable(inputs) }).toEqual({
              ...inputs,
              available: survivesBothGuards(inputs),
            });
          }
        }
      }
    }
  });
});
