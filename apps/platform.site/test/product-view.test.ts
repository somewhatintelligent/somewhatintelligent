/**
 * The product page's BRANCHES, tested without a renderer — which is the whole
 * reason they were split out of `pages/shop/[slug].astro`.
 *
 * All of them are about ABSENCE, and absence is what a template gets wrong: a
 * gallery that reserves a filmstrip cell for a product with one photograph, an
 * accordion that opens onto an operator's empty field, a `Size & fit` drawer
 * captioning a chart nobody uploaded. Each ships looking fine to whoever wrote
 * it, because the product they tested with had all three.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE: the copy. That labels read `01`, that
 * the identifier reads `Object / slug / version`, that an empty size grid says
 * "No sizes published." — those assertions restate a string literal from the
 * module under test, so they can only fail when someone edits both halves and
 * they catch nothing in between. They are snapshots of wording wearing a unit
 * test's clothes, and they make a rewording into a test failure while a real
 * regression walks past.
 */
import { describe, expect, test } from "bun:test";
import type { StorefrontProductDTO } from "platform.commerce/contracts";

import { availabilityLine, productView } from "../src/core/product-view.ts";
import { paragraphs } from "../src/core/markdown.ts";

const product = (overrides: Partial<StorefrontProductDTO> = {}): StorefrontProductDTO => ({
  slug: "friend-001",
  title: "I think we should be friends",
  descriptionMarkdown: "I mean in the C++ way.",
  detailsMarkdown: null,
  sizeGuide: null,
  priceCents: 6_969,
  currency: "cad",
  version: "1.0.0",
  media: [{ href: "/media/a", alt: "front" }],
  variants: [{ id: "v1", size: "M", available: true }],
  ...overrides,
});

const threeImages = [
  { href: "/media/a", alt: "front" },
  { href: "/media/b", alt: "back" },
  { href: "/media/c", alt: "print" },
];

describe("the gallery", () => {
  /**
   * THE FILMSTRIP IS `media.length > 1`, derived by the component rather than
   * carried on the view. What this pins is the input to that: one image stays
   * one, and the gallery is never handed an empty second cell to render.
   */
  test("one image stays one; several stay several", () => {
    expect(productView(product()).media).toHaveLength(1);
    expect(productView(product({ media: threeImages })).media).toHaveLength(3);
  });

  /**
   * POSITION ZERO IS THE COVER, and this is the only rule there is. The DTO
   * arrives ordered by the release's frozen positions, so "first" here is
   * "lowest position" there — no role is consulted because none travels.
   */
  test("the cover is the first entry, whatever the images are of", () => {
    const view = productView(
      product({
        media: [
          { href: "/media/chart-looking-thing", alt: "flat lay" },
          { href: "/media/worn", alt: "worn" },
        ],
      }),
    );
    expect(view.media[0]?.href).toBe("/media/chart-looking-thing");
  });

  test("every plate carries a label and the order is the DTO's", () => {
    const view = productView(product({ media: threeImages }));
    expect(view.media.map((plate) => plate.href)).toEqual(threeImages.map((image) => image.href));
    expect(new Set(view.media.map((plate) => plate.label)).size).toBe(3);
  });

  /**
   * ALT TEXT IS REQUIRED, so a blank one has to become something rather than
   * stay empty — a filmstrip button with no accessible name is unusable. WHAT
   * it becomes is copy and is not asserted.
   */
  test("a blank alt becomes a non-empty one; a real alt is left alone", () => {
    const view = productView(
      product({
        media: [
          { href: "/media/a", alt: "" },
          { href: "/media/b", alt: "back" },
        ],
      }),
    );
    expect(view.media[0]?.alt.length).toBeGreaterThan(0);
    expect(view.media[1]?.alt).toBe("back");
  });
});

describe("the accordions", () => {
  test("a product with neither details nor a size guide has no panels", () => {
    expect(productView(product()).panels).toEqual([]);
  });

  test("details alone give exactly one panel, carrying the operator's prose", () => {
    const view = productView(product({ detailsMarkdown: "240 GSM combed cotton." }));
    expect(view.panels.map((panel) => panel.id)).toEqual(["details"]);
    expect(view.panels[0]?.paragraphs).toEqual(["240 GSM combed cotton."]);
  });

  /**
   * WHITESPACE IS NOT CONTENT. An operator who cleared a field and left a
   * newline behind meant to remove the panel, and a panel that opens onto a
   * blank line is worse than no panel at all.
   */
  test("a details field holding only whitespace is an absent panel", () => {
    expect(productView(product({ detailsMarkdown: "  \n\n  " })).panels).toEqual([]);
  });

  test("the size-guide panel turns on the ASSET, never on the comments", () => {
    const withPlate = productView(
      product({
        sizeGuide: { href: "/media/plate", alt: "Pit-to-pit 50, 53, 56 cm.", notesMarkdown: null },
      }),
    );
    expect(withPlate.panels.map((panel) => panel.id)).toEqual(["size-fit"]);
    /**
     * Comments are optional beside a chart, so the panel exists either way —
     * and its body is never empty, because a drawer that opens onto nothing is
     * worse than one sentence saying where the chart went.
     */
    expect(withPlate.panels[0]?.paragraphs.length).toBeGreaterThan(0);
    expect(withPlate.sizingPlate).toEqual({
      href: "/media/plate",
      alt: "Pit-to-pit 50, 53, 56 cm.",
    });
  });

  test("both panels appear in reading order when both are filled", () => {
    const view = productView(
      product({
        detailsMarkdown: "240 GSM combed cotton.",
        sizeGuide: {
          href: "/media/plate",
          alt: "Pit-to-pit 50, 53, 56 cm.",
          notesMarkdown: "Relaxed unisex fit.\n\nModel is 170 cm and wears M.",
        },
      }),
    );
    expect(view.panels.map((panel) => panel.id)).toEqual(["details", "size-fit"]);
    expect(view.panels[1]?.paragraphs).toEqual([
      "Relaxed unisex fit.",
      "Model is 170 cm and wears M.",
    ]);
  });

  test("no size guide means no sizing plate for the gallery to swap to", () => {
    expect(productView(product()).sizingPlate).toBeNull();
  });
});

describe("the description", () => {
  /** Always its own field, never an accordion — it is the one prose a shopper is guaranteed to see. */
  test("is split into paragraphs and adds no panel", () => {
    const view = productView(
      product({ descriptionMarkdown: "I mean in the C++ way.\n\nShips from Toronto." }),
    );
    expect(view.description).toEqual(["I mean in the C++ way.", "Ships from Toronto."]);
    expect(view.panels).toEqual([]);
  });

  /** An empty list is what tells the template to render no wrapper at all. */
  test("absent is an empty list, not an empty paragraph", () => {
    expect(productView(product({ descriptionMarkdown: null })).description).toEqual([]);
  });
});

describe("availability", () => {
  /**
   * THREE DISTINCT STATES, and the distinction is the behaviour: an operator
   * who published no sizes and a run that sold out are not the same fact. What
   * each one SAYS is copy and is not asserted.
   */
  test("distinguishes unpublished, sold out, and buyable", () => {
    const unpublished = availabilityLine([]);
    const soldOut = availabilityLine([{ id: "v1", size: "M", available: false }]);
    const buyable = availabilityLine([{ id: "v1", size: "M", available: true }]);
    expect(new Set([unpublished, soldOut, buyable]).size).toBe(3);
  });
});

describe("the safe markdown path", () => {
  /**
   * IT RETURNS TEXT, and that is the safety property this file exists to pin.
   * Astro escapes text, so an operator's angle brackets reach the page as
   * characters rather than as markup — there is no injection surface to
   * sanitise rather than a sanitiser to keep correct.
   */
  test("markup an operator types survives as the characters they typed", () => {
    expect(paragraphs("<script>alert(1)</script>")).toEqual(["<script>alert(1)</script>"]);
  });

  test("blank lines separate paragraphs; single newlines do not", () => {
    expect(paragraphs("one\ntwo\n\nthree")).toEqual(["one\ntwo", "three"]);
  });

  /**
   * AN EMPTY LIST IS THE SIGNAL. Every caller renders nothing when it gets one
   * — no wrapper, no accordion, no placeholder — so "absent" and "whitespace"
   * having to collapse to the same value is the property, not a formatting nit.
   */
  test("nothing, whitespace and null all yield no paragraphs", () => {
    expect(paragraphs(null)).toEqual([]);
    expect(paragraphs(undefined)).toEqual([]);
    expect(paragraphs("")).toEqual([]);
    expect(paragraphs("\n  \n")).toEqual([]);
  });
});
