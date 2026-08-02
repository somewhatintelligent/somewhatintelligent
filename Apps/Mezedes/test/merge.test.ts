import { describe, expect, test } from "bun:test";
import { mergeFiles } from "../src/core/merge.ts";

/** The worked example in §6, verbatim. */
const V3 = {
  "App.tsx": "sha:a1c4f0d9",
  "Chart.tsx": "sha:b0f2e7aa",
  "app.css": "sha:77d1cc03",
} as const;

describe("mergeFiles", () => {
  test("the worked example: supplied wins, removed disappears, untouched carries over", () => {
    const v4 = mergeFiles({
      base: V3,
      supplied: { "Chart.tsx": "sha:9e4b81c2", "useData.ts": "sha:2ab60f57" },
      removed: ["app.css"],
    });

    expect(v4).toEqual({
      "App.tsx": "sha:a1c4f0d9",
      "Chart.tsx": "sha:9e4b81c2",
      "useData.ts": "sha:2ab60f57",
    });
  });

  test("the base is left intact, so v3 stays serveable", () => {
    mergeFiles({
      base: V3,
      supplied: { "Chart.tsx": "sha:9e4b81c2" },
      removed: ["app.css"],
    });

    expect(V3).toEqual({
      "App.tsx": "sha:a1c4f0d9",
      "Chart.tsx": "sha:b0f2e7aa",
      "app.css": "sha:77d1cc03",
    });
  });

  test("a path supplied and removed in the same call is removed", () => {
    expect(mergeFiles({ base: {}, supplied: { "a.ts": "sha:1" }, removed: ["a.ts"] })).toEqual({});
  });

  test("removing a path that is not there is a no-op", () => {
    expect(mergeFiles({ base: { "a.ts": "sha:1" }, supplied: {}, removed: ["gone.ts"] })).toEqual({
      "a.ts": "sha:1",
    });
  });

  test("supplying nothing leaves the base alone — omission is not removal", () => {
    expect(mergeFiles({ base: V3, supplied: {}, removed: [] })).toEqual({ ...V3 });
  });

  test("an empty base is a first version", () => {
    expect(mergeFiles({ base: {}, supplied: { "src/client.tsx": "sha:aa" }, removed: [] })).toEqual(
      { "src/client.tsx": "sha:aa" },
    );
  });

  test("the same bytes at a new path are one entry each, not a move", () => {
    expect(
      mergeFiles({
        base: { "a.ts": "sha:same" },
        supplied: { "b.ts": "sha:same" },
        removed: [],
      }),
    ).toEqual({ "a.ts": "sha:same", "b.ts": "sha:same" });
  });

  test("the result is a fresh object, not the base", () => {
    const base = { "a.ts": "sha:1" };
    const merged = mergeFiles({ base, supplied: {}, removed: [] });
    merged["b.ts"] = "sha:2";
    expect(base).toEqual({ "a.ts": "sha:1" });
  });
});
