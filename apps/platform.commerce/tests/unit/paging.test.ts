/**
 * The keyset cursor codec, tested where it lives — with no database and no
 * deployment.
 *
 * Every case here is one the codec's docstring names as a reason it returns
 * `null` rather than throwing: a malformed cursor has to become
 * `invalid_cursor` on the RPC error channel, and a codec that threw would make
 * it a defect instead.
 */
import { describe, expect, test } from "bun:test";

import {
  clampLimit,
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  encodeCursor,
  MAX_PAGE_LIMIT,
  pageWindow,
  splitPage,
} from "../../core/paging.ts";

describe("cursor codec", () => {
  test("round-trips a cursor", () => {
    const cursor = { at: 1_767_225_600_000, id: "01JQTEST0000000000000000" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  test("emits base64url, never standard base64", () => {
    // `+` and `/` in a cursor would be mangled by a querystring round trip.
    for (let at = 1_767_225_600_000; at < 1_767_225_600_060; at += 1) {
      const encoded = encodeCursor({ at, id: "01JQ~TEST/ID+VALUE" });
      expect(encoded).not.toContain("+");
      expect(encoded).not.toContain("/");
      expect(encoded).not.toContain("=");
    }
  });

  test("an id containing a colon survives — only the FIRST colon splits", () => {
    const cursor = { at: 1, id: "weird:id:with:colons" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  describe("returns null rather than throwing", () => {
    test("for undecodable base64", () => {
      expect(decodeCursor("!!!not base64!!!")).toBeNull();
    });

    test("when there is no separator", () => {
      expect(decodeCursor(encodeRaw("1767225600000"))).toBeNull();
    });

    test("for an empty head — Number('') would coerce to 0", () => {
      expect(decodeCursor(encodeRaw(":some-id"))).toBeNull();
    });

    test("for a non-digit head", () => {
      expect(decodeCursor(encodeRaw("not-a-number:some-id"))).toBeNull();
      expect(decodeCursor(encodeRaw("-1:some-id"))).toBeNull();
      expect(decodeCursor(encodeRaw("1.5:some-id"))).toBeNull();
    });

    test("for an empty id", () => {
      expect(decodeCursor(encodeRaw("1767225600000:"))).toBeNull();
    });

    test("beyond the safe integer range", () => {
      expect(decodeCursor(encodeRaw("99999999999999999999:some-id"))).toBeNull();
    });
  });
});

describe("clampLimit", () => {
  test("defaults when absent", () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
  });

  test("defaults for non-finite input rather than clamping it", () => {
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_PAGE_LIMIT);
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PAGE_LIMIT);
  });

  test("clamps into [1, MAX]", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-10)).toBe(1);
    expect(clampLimit(MAX_PAGE_LIMIT + 1_000)).toBe(MAX_PAGE_LIMIT);
  });

  test("truncates fractions rather than rounding", () => {
    expect(clampLimit(9.9)).toBe(9);
  });

  test("passes a value already in range", () => {
    expect(clampLimit(50)).toBe(50);
  });
});

describe("splitPage", () => {
  const keyOf = (row: { at: number; id: string }) => row;
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ at: 1_000 - index, id: `id-${index}` }));

  test("a full-but-not-over page has no next cursor", () => {
    const { page, nextCursor } = splitPage(rows(10), 10, keyOf);
    expect(page).toHaveLength(10);
    expect(nextCursor).toBeNull();
  });

  test("the over-fetched row is dropped and signals a next page", () => {
    const { page, nextCursor } = splitPage(rows(11), 10, keyOf);
    expect(page).toHaveLength(10);
    expect(nextCursor).not.toBeNull();
  });

  test("the cursor points at the LAST RETAINED row, not the extra one", () => {
    const { nextCursor } = splitPage(rows(11), 10, keyOf);
    // Index 9 is retained; index 10 is the over-fetch that proves there is more.
    expect(decodeCursor(nextCursor as string)).toEqual({ at: 991, id: "id-9" });
  });

  test("an empty result has no cursor and does not throw", () => {
    const { page, nextCursor } = splitPage([], 10, keyOf);
    expect(page).toEqual([]);
    expect(nextCursor).toBeNull();
  });

  test("does not mutate the caller's array", () => {
    const source = rows(11);
    splitPage(source, 10, keyOf);
    expect(source).toHaveLength(11);
  });
});

/** Encode a raw payload the codec would otherwise never produce. */
const encodeRaw = (value: string): string =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * `pageWindow` — the two paging inputs decided together.
 *
 * The asymmetry is the point and is easy to get backwards: a bad LIMIT is
 * clamped, a bad CURSOR is refused. Silently starting from the top on an
 * undecodable cursor would hand a caller page one while they believed they were
 * paging forward, so the same list would be walked forever.
 */
describe("pageWindow", () => {
  test("no cursor starts at the top with a clamped limit", () => {
    expect(pageWindow({})).toEqual({ ok: true, value: { limit: DEFAULT_PAGE_LIMIT, after: null } });
    expect(pageWindow({ limit: 5000 })).toEqual({
      ok: true,
      value: { limit: MAX_PAGE_LIMIT, after: null },
    });
    expect(pageWindow({ limit: 0 })).toEqual({ ok: true, value: { limit: 1, after: null } });
  });

  test("a decodable cursor is carried through beside the limit", () => {
    const cursor = encodeCursor({ at: 1700000000000, id: "01ABC" });
    expect(pageWindow({ cursor, limit: 10 })).toEqual({
      ok: true,
      value: { limit: 10, after: { at: 1700000000000, id: "01ABC" } },
    });
  });

  test("an undecodable cursor is REFUSED, never treated as absent", () => {
    for (const cursor of ["not-base64!!", "", "AAAA", encodeCursor({ at: 1, id: "x" }) + "!!"]) {
      const result = pageWindow({ cursor });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_cursor");
    }
  });

  test("a bad limit alongside a bad cursor still refuses rather than clamping past it", () => {
    expect(pageWindow({ cursor: "garbage!", limit: -1 }).ok).toBe(false);
  });
});
