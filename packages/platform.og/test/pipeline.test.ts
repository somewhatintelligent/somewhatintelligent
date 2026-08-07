/**
 * The pipeline's two contracts: WHAT IT REFUSES, and that identical inputs give
 * identical bytes.
 *
 * The refusals are the useful half. A definition missing `size` fails somewhere
 * inside yoga with a message about a layout node and no filename in it; the
 * assertions below are that discovery says which file and which field instead.
 *
 * Determinism is not a nice property here, it is load-bearing: the CLI skips
 * rewriting unchanged files on it, and both consumers guard their committed
 * PNGs against drift by re-rendering and comparing.
 */
import { describe, expect, test } from "bun:test";

import { assertOgDefinition } from "../src/discover.ts";
import { renderOg } from "../src/render.ts";

describe("assertOgDefinition", () => {
  const valid = { name: "card", size: { width: 8, height: 8 }, render: () => null };

  test("accepts a well-formed definition", () => {
    expect(() => assertOgDefinition("card.og.tsx", valid)).not.toThrow();
  });

  test("names the file and the field it refuses on", () => {
    expect(() => assertOgDefinition("card.og.tsx", { ...valid, name: "" })).toThrow(
      /card\.og\.tsx: OgDefinition\.name/,
    );
    expect(() => assertOgDefinition("card.og.tsx", { ...valid, size: undefined })).toThrow(
      /card\.og\.tsx: OgDefinition\.size/,
    );
    expect(() => assertOgDefinition("card.og.tsx", { ...valid, render: "nope" })).toThrow(
      /card\.og\.tsx: OgDefinition\.render/,
    );
    expect(() => assertOgDefinition("card.og.tsx", null)).toThrow(/not an OgDefinition/);
  });
});

describe("renderOg", () => {
  const size = { width: 24, height: 24 };
  /** A plate with no text — which is the whole point: no font is needed for one. */
  const plate = {
    type: "div",
    key: null,
    props: { style: { width: "100%", height: "100%", background: "#080908" } },
  };

  test("a definition with no text renders without a font declared", async () => {
    const png = await renderOg(plate as never, { size });
    /** The eight-byte PNG signature — proof it is a raster, not an SVG string. */
    expect(Buffer.from(png.slice(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("the same input renders the same bytes", async () => {
    const [first, second] = await Promise.all([
      renderOg(plate as never, { size }),
      renderOg(plate as never, { size }),
    ]);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});
