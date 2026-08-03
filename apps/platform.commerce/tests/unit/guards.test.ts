/**
 * Reading a batch result.
 *
 * The coupling under test is the one the comments call load-bearing: line
 * guards come first, run guards immediately after, and `classifyGuards` reads
 * them POSITIONALLY because positional correspondence is all a D1 batch returns.
 * Get the offset wrong and a lost stock guard is read as a full run — the buyer
 * is told the wrong thing and the wrong compensation runs.
 */
import { describe, expect, test } from "bun:test";

import { classifyGuards, firstLostGuard, guardWon, type GuardResult } from "../../core/guards.ts";
import type { OrderLine, RunClaim } from "../../core/pricing.ts";

const lineOf = (variantId: string, productId: string, preorder = false): OrderLine => ({
  variantId,
  productId,
  title: "Item",
  size: "M",
  unitPriceCents: 1_000,
  quantity: 1,
  preorder,
  expectedShipAt: null,
});

const claimOf = (productId: string): RunClaim => ({ productId, title: "Item", quantity: 1 });

/** A D1 statement result for a guard that matched, or did not. */
const won: GuardResult = { meta: { changes: 1 } };
const lost: GuardResult = { meta: { changes: 0 } };

/**
 * `guardWon` now arbitrates the IDEMPOTENCY CLAIM as well as the stock guards.
 * The claim used to report its loss as a constraint violation carrying driver
 * prose, recognised by regex; it is now an `ON CONFLICT DO NOTHING` insert whose
 * loss is a zero-row result. Everything below is what "lost" has to mean.
 */
describe("guardWon", () => {
  test("exactly one row is the only win", () => {
    expect(guardWon({ meta: { changes: 1 } })).toBe(true);
  });

  test("zero rows is a loss — the predicate did not match", () => {
    expect(guardWon({ meta: { changes: 0 } })).toBe(false);
  });

  test("more than one row is a loss — the statement was not what we think", () => {
    expect(guardWon({ meta: { changes: 2 } })).toBe(false);
  });

  test("absent metadata fails closed", () => {
    expect(guardWon({})).toBe(false);
    expect(guardWon({ meta: {} })).toBe(false);
    expect(guardWon(undefined)).toBe(false);
  });
});

/**
 * `Audit.command` commits a core's statements alongside the ledger row and only
 * then learns whether the conditional ones took. This is that check — the thing
 * standing between "the guard matched nothing" and "the ledger recorded a
 * success that never happened, and will replay it".
 */
describe("firstLostGuard", () => {
  const guards = [
    { index: 0, error: "negative_stock" },
    { index: 2, error: "cap_below_claimed" },
  ];

  test("all guards taking means no failure", () => {
    expect(firstLostGuard(guards, [won, lost, won])).toBeUndefined();
  });

  test("a guarded statement that matched nothing is reported", () => {
    expect(firstLostGuard(guards, [won, won, lost])?.error).toBe("cap_below_claimed");
  });

  test("the FIRST loser wins, in declaration order", () => {
    expect(firstLostGuard(guards, [lost, won, lost])?.error).toBe("negative_stock");
  });

  test("unguarded statements are not inspected", () => {
    // Index 1 is a plain insert; its result is irrelevant either way.
    expect(firstLostGuard([{ index: 0, error: "x" }], [won, lost])).toBeUndefined();
  });

  test("a core declaring no guards is unaffected", () => {
    expect(firstLostGuard(undefined, [lost, lost])).toBeUndefined();
    expect(firstLostGuard([], [lost])).toBeUndefined();
  });

  /**
   * A mis-declared index must fail closed. Reading it as a pass would make the
   * check silently evaporate — the exact failure the guard exists to prevent.
   */
  test("an out-of-range index reads as a loss", () => {
    expect(firstLostGuard([{ index: 9, error: "boom" }], [won])?.error).toBe("boom");
  });
});

describe("line guards", () => {
  const lines = [lineOf("v1", "p1"), lineOf("v2", "p1"), lineOf("v3", "p1")];

  test("every guard matching means nothing failed", () => {
    const result = classifyGuards(lines, [], [won, won, won]);
    expect(result.succeeded).toHaveLength(3);
    expect(result.firstFailing).toBeUndefined();
  });

  test("a zero-row guard is a loss, and the FIRST one is reported", () => {
    const result = classifyGuards(lines, [], [won, lost, lost]);
    expect(result.firstFailing?.variantId).toBe("v2");
  });

  /**
   * The winners committed alongside the loser — a zero-row UPDATE does not abort
   * a D1 batch — so they have to be handed back explicitly. Losing the list of
   * winners means stranding their stock permanently.
   */
  test("winners are still collected when a later guard loses", () => {
    const result = classifyGuards(lines, [], [won, lost, won]);
    expect(result.succeeded.map((line) => line.variantId)).toEqual(["v1", "v3"]);
  });

  test("a missing result reads as a loss rather than a win", () => {
    const result = classifyGuards(lines, [], [won]);
    expect(result.firstFailing?.variantId).toBe("v2");
    expect(result.succeeded).toHaveLength(1);
  });

  test("absent meta reads as a loss", () => {
    const result = classifyGuards(lines, [], [{}, won, won]);
    expect(result.firstFailing?.variantId).toBe("v1");
  });

  /**
   * A guard is a compare-and-set against ONE row by primary key, so exactly one
   * row should change. Anything else means the statement did not do what the
   * caller believes, and reading it as success would confirm a reservation that
   * never happened.
   */
  test("a multi-row change is not counted as a win", () => {
    const result = classifyGuards(lines, [], [{ meta: { changes: 2 } }, won, won]);
    expect(result.firstFailing?.variantId).toBe("v1");
  });
});

describe("run guards read at the correct offset", () => {
  const lines = [lineOf("v1", "p1", true), lineOf("v2", "p1", true)];
  const claims = [claimOf("p1")];

  test("run guards are read AFTER the line guards, not among them", () => {
    // Both lines won; the run guard lost. Read at the wrong offset this would
    // surface as a failing LINE instead of a full run.
    const result = classifyGuards(lines, claims, [won, won, lost]);
    expect(result.firstFailing).toBeUndefined();
    expect(result.firstFullRun?.productId).toBe("p1");
    expect(result.claimed).toHaveLength(0);
  });

  test("a full run is distinguished from a lost line", () => {
    const result = classifyGuards(lines, claims, [lost, won, won]);
    expect(result.firstFailing?.variantId).toBe("v1");
    expect(result.firstFullRun).toBeUndefined();
    expect(result.claimed).toHaveLength(1);
  });

  test("both can lose at once", () => {
    const result = classifyGuards(lines, claims, [lost, won, lost]);
    expect(result.firstFailing?.variantId).toBe("v1");
    expect(result.firstFullRun?.productId).toBe("p1");
  });

  test("claims that won are collected so they can be compensated", () => {
    const twoClaims = [claimOf("p1"), claimOf("p2")];
    const result = classifyGuards(lines, twoClaims, [won, won, won, lost]);
    expect(result.claimed.map((claim) => claim.productId)).toEqual(["p1"]);
    expect(result.firstFullRun?.productId).toBe("p2");
  });

  test("results beyond the guards are ignored", () => {
    // Checkout appends order writes after the guards; they must not be read.
    const result = classifyGuards(lines, claims, [won, won, won, won, won, won]);
    expect(result.succeeded).toHaveLength(2);
    expect(result.claimed).toHaveLength(1);
    expect(result.firstFailing).toBeUndefined();
    expect(result.firstFullRun).toBeUndefined();
  });
});

describe("degenerate inputs", () => {
  test("no lines and no claims classifies nothing", () => {
    const result = classifyGuards([], [], []);
    expect(result).toEqual({
      succeeded: [],
      firstFailing: undefined,
      claimed: [],
      firstFullRun: undefined,
    });
  });

  test("a cart with no pre-orders has no run guards to read", () => {
    const result = classifyGuards([lineOf("v1", "p1")], [], [won]);
    expect(result.firstFullRun).toBeUndefined();
    expect(result.claimed).toEqual([]);
  });
});
