/**
 * THE COMMITTED CARDS ARE STILL WHAT THE DEFINITIONS RENDER.
 *
 * `public/og/*.png` is build output that lives in git — which is the right call
 * (see `packages/platform.og`), and which buys exactly one problem: the artwork
 * and the code that draws it can drift, and nothing about a stale PNG looks
 * wrong until it is already in someone's feed with last quarter's wordmark on
 * it. `bun run og` is a step a person has to remember; this is the thing that
 * remembers for them.
 *
 * It works because satori and resvg are deterministic — identical inputs give
 * identical bytes, which the pipeline already relies on to avoid rewriting
 * unchanged files.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { discoverOgDefinitions, loadFonts, loadOgConfig, renderOg } from "platform.og";

const APP_ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = resolve(APP_ROOT, "public/og");

const definitions = await discoverOgDefinitions(APP_ROOT);
const fonts = await loadFonts((await loadOgConfig(APP_ROOT)).fonts ?? [], APP_ROOT);

describe("og cards", () => {
  test("every definition is discovered", () => {
    expect(definitions.map(({ definition }) => definition.name).sort()).toEqual([
      "apple-icon",
      "icon",
      "icon-512",
      "opengraph-image",
      "twitter-image",
    ]);
  });

  /**
   * 1200×630 is not a preference. Below 600×315 Facebook drops to the small
   * card and below 200×200 it refuses the image; the icons answer to Google's
   * "multiple of 48" favicon guidance and iOS's 180.
   */
  test("the sizes are the ones the meta tags and the manifest declare", () => {
    const sizes = Object.fromEntries(
      definitions.map(({ definition }) => [
        definition.name,
        `${definition.size.width}x${definition.size.height}`,
      ]),
    );
    expect(sizes).toEqual({
      "apple-icon": "180x180",
      icon: "96x96",
      "icon-512": "512x512",
      "opengraph-image": "1200x630",
      "twitter-image": "1200x630",
    });
  });

  for (const { definition } of definitions) {
    test(`${definition.name}.png is current — run \`bun run og\` if this fails`, async () => {
      const rendered = await renderOg(await definition.render(), {
        size: definition.size,
        fonts,
      });
      const committed = await readFile(resolve(OUT_DIR, `${definition.name}.png`));
      expect(Buffer.from(rendered).equals(committed)).toBe(true);
    });
  }
});
