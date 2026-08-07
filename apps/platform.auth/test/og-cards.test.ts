/**
 * THE COMMITTED CARDS ARE STILL WHAT THE DEFINITIONS RENDER.
 *
 * `public/og/*.png` is build output living in git, and `bun run og` is a step a
 * person has to remember. Nothing about a stale card looks wrong until it is in
 * someone's feed with the old wordmark on it, so this remembers instead.
 *
 * It is possible because satori and resvg are deterministic — the same property
 * the pipeline uses to avoid rewriting unchanged files.
 *
 * THIS APP'S TAGS POINTED AT THESE FILES BEFORE ANY OF THEM EXISTED: the paths
 * came over with the port and the pipeline that produces them did not, so every
 * favicon and card request 404'd. A guard on the artwork is also a guard on that
 * not happening twice.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";

import { discoverOgDefinitions, loadFonts, loadOgConfig, renderOg } from "platform.og";

const APP_ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = resolve(APP_ROOT, "public/og");

const definitions = await discoverOgDefinitions(APP_ROOT);
const fonts = await loadFonts((await loadOgConfig(APP_ROOT)).fonts ?? [], APP_ROOT);

describe("og cards", () => {
  /** The sizes `app/routes/__root.tsx` and `public/site.webmanifest` declare. */
  test("the declared sizes are the rendered ones", () => {
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
