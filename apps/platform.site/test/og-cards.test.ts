/**
 * THE COMMITTED CARDS ARE STILL WHAT THE DEFINITIONS RENDER.
 *
 * The assertion itself lives in `platform.og` — see `verifyOgCards` for why the
 * pipeline commits its output and what that costs. What is here is the part
 * that is this app's: which cards it publishes, and at what size the `<meta>`
 * tags and `public/site.webmanifest` claim they are.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { verifyOgCards } from "platform.og";

const checks = await verifyOgCards(resolve(import.meta.dirname, ".."));

describe("og cards", () => {
  /**
   * 1200×630 is not a preference: below 600×315 Facebook drops to the small
   * card and below 200×200 it refuses the image. The icons answer to Google's
   * "multiple of 48" favicon guidance and iOS's 180.
   */
  test("the published set, at the sizes the head and the manifest declare", () => {
    expect(Object.fromEntries(checks.map((card) => [card.name, card.dimensions]))).toEqual({
      "apple-icon": "180x180",
      icon: "96x96",
      "icon-512": "512x512",
      "opengraph-image": "1200x630",
      "twitter-image": "1200x630",
    });
  });

  for (const card of checks) {
    test(`${card.name}.png is current — run \`bun run og\` if this fails`, () => {
      expect(card.current).toBe(true);
    });
  }
});
