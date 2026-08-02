import { describe, expect, test } from "bun:test";
import { classify, diagnostic } from "../src/core/diagnostics.ts";

describe("classify", () => {
  test.each([2307, 2792, 2688, 6053, 2691])(
    "TS%i means the module is missing, not that the code is wrong",
    (code) => {
      expect(classify("Cannot find module './nowhere'.", code)).toBe("resolution");
      // The code decides even when the text reads like a type error.
      expect(classify("Type 'string' is not assignable to type 'number'.", code)).toBe(
        "resolution",
      );
    },
  );

  test.each([
    ['Could not resolve "lodash"'],
    ["Cannot find module 'react-dom/client'"],
    ["Module not found: chartz"],
    ["Failed to resolve entry for package"],
    ["No matching version found for d3@^99.0.0"],
    ["version not found for chartz@1.0.0"],
    ["registry returned 404 Not Found"],
    ["chartz is not in this registry"],
    ["ENOTFOUND registry.npmjs.org"],
    ["ETARGET no such version"],
    ["package chartz does not exist"],
  ])("%p is a resolution failure — change approach", (message) => {
    expect(classify(message)).toBe("resolution");
  });

  test.each([
    ["Internal error while linking"],
    ["Unexpected token in bundler output"],
    ["panic: runtime error"],
    ["JavaScript heap out of memory"],
    ["Worker exceeded CPU time limit"],
    ["Assertion failed: manifest present"],
  ])("%p is internal — stop and tell the human", (message) => {
    expect(classify(message)).toBe("internal");
  });

  test.each([
    ["Type 'string' is not assignable to type 'number'."],
    ["Property 'age' does not exist on type '{ name: string; }'."],
    ["Expected 1 arguments, but got 2."],
    [""],
  ])("%p is semantic — fix and retry", (message) => {
    expect(classify(message)).toBe("semantic");
  });

  test("semantic is the default, so an unrecognised failure is still actionable", () => {
    expect(classify("something nobody has seen before")).toBe("semantic");
  });

  test("a resolution code outranks the message text", () => {
    expect(classify("Internal error", 2307)).toBe("resolution");
  });

  test("resolution outranks internal in the text, so a retry is not proposed for a missing package", () => {
    expect(classify('internal error: could not resolve "chartz"')).toBe("resolution");
  });

  test("a code outside the resolution set leaves the text to decide", () => {
    expect(classify("Type 'string' is not assignable to type 'number'.", 2322)).toBe("semantic");
    expect(classify("Cannot find module 'chartz'", 2322)).toBe("resolution");
  });
});

describe("diagnostic", () => {
  test("classifies from the message when no kind is given", () => {
    expect(diagnostic({ message: 'Could not resolve "chartz"' }).kind).toBe("resolution");
  });

  test("an explicit kind is not second-guessed", () => {
    expect(diagnostic({ kind: "internal", message: "Cannot find module 'x'" }).kind).toBe(
      "internal",
    );
  });

  test("position defaults name the whole submission rather than a wrong line", () => {
    expect(diagnostic({ message: "boom" })).toEqual({
      kind: "semantic",
      file: "<unknown>",
      line: 0,
      column: 0,
      message: "boom",
    });
  });

  test("the code key is absent rather than undefined", () => {
    const without = diagnostic({ message: "boom" });
    expect(Object.hasOwn(without, "code")).toBe(false);
    expect(diagnostic({ message: "boom", code: 2322 }).code).toBe(2322);
  });

  test("a supplied position is carried through", () => {
    expect(
      diagnostic({ file: "src/App.tsx", line: 12, column: 3, message: "boom", code: 2322 }),
    ).toEqual({
      kind: "semantic",
      file: "src/App.tsx",
      line: 12,
      column: 3,
      message: "boom",
      code: 2322,
    });
  });
});
