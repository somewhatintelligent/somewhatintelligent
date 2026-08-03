/**
 * ULID minting.
 *
 * `Ids.ts` names two properties the store actually relies on, and until now
 * neither had a test:
 *
 *  - LEXICOGRAPHIC ORDER FOLLOWS TIME ORDER, because the `(updated_at DESC,
 *    id DESC)` keyset page uses the id as its tiebreak. An id whose sort order
 *    is unrelated to insertion order would page rows in an order the cursor
 *    cannot reproduce — rows silently skipped or repeated mid-pagination.
 *  - UNIQUENESS WITHIN ONE MILLISECOND, because a deletion batch mints several
 *    rows in the same tick and each needs its own primary key.
 *
 * Both are properties of ids minted in the SAME millisecond, which is the case
 * a wall-clock test would almost never hit by accident. Minting in a tight loop
 * is what forces it.
 */
import { describe, expect, test } from "bun:test";
import * as Effect from "effect/Effect";

import { Ids } from "../../services/Ids.ts";

/** Mint `count` ids through a layer, synchronously. */
const mint = (count: number, layer: typeof Ids.layer) =>
  Effect.runSync(
    Effect.provide(
      Effect.gen(function* () {
        const ids = yield* Ids;
        return yield* ids.many(count);
      }),
      layer,
    ),
  );

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;

describe("the real minter", () => {
  test("produces 26-character Crockford base32", () => {
    for (const id of mint(50, Ids.layer)) {
      expect(id).toHaveLength(26);
      expect(id).toMatch(CROCKFORD);
    }
  });

  test("excludes the ambiguous letters I, L, O and U", () => {
    for (const id of mint(200, Ids.layer)) {
      expect(id).not.toMatch(/[ILOU]/);
    }
  });

  /**
   * 500 ids in a tight loop land in a handful of milliseconds, so most of these
   * exercise the same-tick increment path rather than a fresh seed.
   */
  test("ids minted in the same millisecond are distinct", () => {
    const ids = mint(500, Ids.layer);
    expect(new Set(ids).size).toBe(500);
  });

  test("lexicographic order follows mint order", () => {
    const ids = mint(500, Ids.layer);
    expect([...ids].sort()).toEqual(ids);
  });

  /**
   * The tiebreak the keyset page depends on: within one millisecond the
   * timestamp prefix is IDENTICAL, so ordering has to come from the random
   * tail being incremented rather than redrawn.
   */
  test("ids sharing a timestamp prefix still sort in mint order", () => {
    const ids = mint(500, Ids.layer);
    const byPrefix = new Map<string, string[]>();
    for (const id of ids) {
      const prefix = id.slice(0, 10);
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), id]);
    }
    const sameTick = [...byPrefix.values()].filter((group) => group.length > 1);
    expect(sameTick.length).toBeGreaterThan(0);
    for (const group of sameTick) {
      expect([...group].sort()).toEqual(group);
    }
  });

  test("two independent layers do not mint the same id", () => {
    const a = mint(100, Ids.layer);
    const b = mint(100, Ids.layer);
    expect(new Set([...a, ...b]).size).toBe(200);
  });
});

/**
 * `Ids.fixed` exists so a test can assert on an id without the wall clock. It
 * has to hold the SAME ordering property as the real minter — a keyset
 * pagination test built on ids that did not sort in mint order would pass while
 * describing behaviour the real minter never produces.
 */
describe("the fixed minter", () => {
  test("is deterministic across layers", () => {
    expect(mint(3, Ids.fixed())).toEqual(mint(3, Ids.fixed()));
  });

  test("honours its prefix", () => {
    expect(mint(2, Ids.fixed("order"))).toEqual(["order-000001", "order-000002"]);
  });

  test("sorts in mint order, like the real minter", () => {
    const ids = mint(120, Ids.fixed());
    expect([...ids].sort()).toEqual(ids);
  });

  test("is distinct within a run", () => {
    const ids = mint(120, Ids.fixed());
    expect(new Set(ids).size).toBe(120);
  });
});
