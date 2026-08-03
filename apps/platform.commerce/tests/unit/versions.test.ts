/**
 * Version labels and the idempotency key.
 *
 * `nextVersion` is the interesting one: it exists so an operator never has to
 * invent a number, which means its job is to always produce something valid and
 * never to collide with what a product already published.
 */
import { describe, expect, test } from "bun:test";

import { deriveIdempotencyKey, err, ok } from "../../core/result.ts";
import { compareVersions, isValidVersion, nextVersion } from "../../core/versions.ts";

describe("isValidVersion", () => {
  test("accepts canonical core semver", () => {
    for (const version of ["0.0.0", "1.0.0", "1.2.3", "10.20.30"]) {
      expect(isValidVersion(version)).toBe(true);
    }
  });

  test("rejects a `v` prefix", () => {
    expect(isValidVersion("v1.0.0")).toBe(false);
  });

  test("rejects leading zeros", () => {
    expect(isValidVersion("01.0.0")).toBe(false);
    expect(isValidVersion("1.02.0")).toBe(false);
  });

  test("rejects pre-release and build metadata", () => {
    expect(isValidVersion("1.0.0-rc.1")).toBe(false);
    expect(isValidVersion("1.0.0+build")).toBe(false);
  });

  test("rejects partial versions", () => {
    expect(isValidVersion("1.0")).toBe(false);
    expect(isValidVersion("1")).toBe(false);
    expect(isValidVersion("")).toBe(false);
  });
});

describe("nextVersion", () => {
  test("a product with no releases starts at 1.0.0", () => {
    expect(nextVersion([])).toBe("1.0.0");
  });

  test("minor is the default, because a release usually is one", () => {
    expect(nextVersion(["1.0.0"])).toBe("1.1.0");
    expect(nextVersion(["1.0.0", "1.1.0", "1.2.0"])).toBe("1.3.0");
  });

  test("all three parts can move", () => {
    expect(nextVersion(["1.4.2"], "major")).toBe("2.0.0");
    expect(nextVersion(["1.4.2"], "minor")).toBe("1.5.0");
    expect(nextVersion(["1.4.2"], "patch")).toBe("1.4.3");
  });

  test("a major bump resets minor and patch", () => {
    expect(nextVersion(["3.9.9"], "major")).toBe("4.0.0");
  });

  test("a minor bump resets patch", () => {
    expect(nextVersion(["1.2.7"], "minor")).toBe("1.3.0");
  });

  /**
   * DERIVED FROM THE LATEST, not the largest component seen anywhere. Reading
   * only the minor and pasting it under a hardcoded major produced `1.1.0`
   * after a hand-supplied `2.0.0` — a version lower than its own predecessor.
   */
  test("respects a major an operator supplied by hand", () => {
    expect(nextVersion(["1.0.0", "2.0.0"])).toBe("2.1.0");
  });

  test("a lone 2.3.0 derives from itself, not from a phantom 1.x", () => {
    expect(nextVersion(["2.3.0"])).toBe("2.4.0");
  });

  test("finds the latest by semver order, not by array order", () => {
    expect(nextVersion(["1.5.0", "2.0.0", "1.9.0"])).toBe("2.1.0");
    expect(nextVersion(["1.10.0", "1.9.0"])).toBe("1.11.0");
  });

  test("patch releases do not raise the minor", () => {
    expect(nextVersion(["1.0.0", "1.0.1"], "patch")).toBe("1.0.2");
  });

  /** One bad row written by hand must not drag every future derivation down. */
  test("unparseable versions are ignored rather than coerced", () => {
    expect(nextVersion(["1.2.0", "banana", "v3", "1.0"])).toBe("1.3.0");
    expect(nextVersion(["nonsense"])).toBe("1.0.0");
  });

  test("always produces something isValidVersion accepts", () => {
    const published: string[] = [];
    const bumps = ["minor", "patch", "major"] as const;
    for (let i = 0; i < 30; i += 1) {
      const next = nextVersion(published, bumps[i % 3]);
      expect(isValidVersion(next)).toBe(true);
      published.push(next);
    }
  });

  /** The property that actually matters: a derived version never sorts below its predecessor. */
  test("never derives a version lower than the latest it derived from", () => {
    const published: string[] = [];
    const bumps = ["minor", "patch", "major", "patch", "minor"] as const;
    for (let i = 0; i < 40; i += 1) {
      const previous = [...published].sort(compareVersions).pop();
      const next = nextVersion(published, bumps[i % 5]);
      if (previous !== undefined) expect(compareVersions(next, previous)).toBeGreaterThan(0);
      published.push(next);
    }
    expect(new Set(published).size).toBe(published.length);
  });
});

describe("compareVersions", () => {
  test("orders by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.1.2", "1.1.1")).toBeGreaterThan(0);
  });

  test("is zero for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  test("sorts a list into ascending order", () => {
    const sorted = ["1.10.0", "1.2.0", "2.0.0", "1.0.0"].sort(compareVersions);
    expect(sorted).toEqual(["1.0.0", "1.2.0", "1.10.0", "2.0.0"]);
  });
});

describe("deriveIdempotencyKey", () => {
  test("namespaces by actor and action", () => {
    expect(deriveIdempotencyKey("operator:abc", "createProduct", "cmd-1")).toBe(
      "operator:abc:createProduct:cmd-1",
    );
  });

  test("the same command id from two actors cannot collide", () => {
    expect(deriveIdempotencyKey("operator:a", "createProduct", "cmd-1")).not.toBe(
      deriveIdempotencyKey("operator:b", "createProduct", "cmd-1"),
    );
  });

  test("the same command id across two actions cannot collide", () => {
    expect(deriveIdempotencyKey("operator:a", "createProduct", "cmd-1")).not.toBe(
      deriveIdempotencyKey("operator:a", "deleteProduct", "cmd-1"),
    );
  });

  test("is stable — a retry of the same command derives the same key", () => {
    expect(deriveIdempotencyKey("operator:a", "createProduct", "cmd-1")).toBe(
      deriveIdempotencyKey("operator:a", "createProduct", "cmd-1"),
    );
  });
});

describe("result envelope", () => {
  test("ok carries the value", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  /**
   * The whole result is JSON-serialised into the audit row and replayed
   * verbatim, so key PRESENCE has to be byte-stable across a replay — an
   * explicit `message: undefined` would serialise differently.
   */
  test("err without a message omits the key entirely", () => {
    const result = err("not_found");
    expect("message" in result).toBe(false);
    expect(JSON.stringify(result)).toBe('{"ok":false,"error":"not_found"}');
  });

  test("err with a message includes it", () => {
    expect(err("out_of_stock", "Tee (M)")).toEqual({
      ok: false,
      error: "out_of_stock",
      message: "Tee (M)",
    });
  });

  test("a replayed err serialises identically to the original", () => {
    const first = JSON.stringify(err("not_found"));
    const second = JSON.stringify(JSON.parse(first));
    expect(second).toBe(first);
  });
});
