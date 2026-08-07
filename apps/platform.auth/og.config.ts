import { fileURLToPath } from "node:url";

import { defineOgConfig, type FontInput, type FontWeight } from "platform.og";

/**
 * FONTS FOR THE RASTER PIPELINE, and the reason this file exists at all.
 *
 * satori reads neither `@font-face` nor a CSS custom property — it takes font
 * BYTES. So `platform.design/fonts.css` and `--font-display` are both invisible
 * to a card, and the two families the site actually sets type in have to be
 * handed over as files here. Swap these when the typefaces change; the design
 * package's `tokens/typography.ts` is the other half of that edit.
 *
 * Resolved through the package specifier rather than a relative path so the
 * config survives the app moving inside the workspace.
 */
const designFont = (rel: string): string =>
  fileURLToPath(import.meta.resolve(`platform.design/fonts/${rel}`));

/** Barlow Condensed — `--font-display`. The wordmark and every card title. */
const displayWeights: Array<[FontWeight, string]> = [
  [300, "BarlowCondensed-Light.ttf"],
  [400, "BarlowCondensed-Regular.ttf"],
  [700, "BarlowCondensed-Bold.ttf"],
  [900, "BarlowCondensed-Black.ttf"],
];

/** Iosevka — `--font-mono`. Eyebrows, identifiers, and anything set as evidence. */
const monoWeights: Array<[FontWeight, string]> = [
  [400, "Iosevka-Regular.ttf"],
  [700, "Iosevka-Bold.ttf"],
];

const fonts: FontInput[] = [
  ...displayWeights.map(
    ([weight, file]): FontInput => ({
      name: "Barlow Condensed",
      weight,
      style: "normal",
      path: designFont(`barlow-condensed/${file}`),
    }),
  ),
  ...monoWeights.map(
    ([weight, file]): FontInput => ({
      name: "Iosevka",
      weight,
      style: "normal",
      path: designFont(`iosevka/${file}`),
    }),
  ),
];

export default defineOgConfig({ fonts });
