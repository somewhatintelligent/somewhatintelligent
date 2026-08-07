import { fileURLToPath } from "node:url";

/**
 * THE FONT BYTES EVERY SOCIAL CARD IS SET IN, declared by the package that owns
 * the files.
 *
 * satori reads neither `@font-face` nor a CSS custom property — it takes font
 * BYTES — so `../fonts.css` and `--font-display` are both invisible to a card
 * and the typefaces have to be handed over as paths. That is a fact about
 * satori, not about any one app, which is why the list lives here: the same
 * manifest copied into each consumer's `og.config.ts` meant a typeface swap was
 * an N-app edit, and this package's whole contract is that a reskin touches it
 * and nothing else.
 *
 * ONLY THE WEIGHTS A CARD ACTUALLY DRAWS WITH. `OgLockup` sets Barlow Condensed
 * 700 for the wordmark and Iosevka 400 for the eyebrow; the icon definitions
 * contain no text node at all. Every other face is bytes read off disk, handed
 * to satori and never asked for — and Iosevka ships ~10 MB PER WEIGHT, so
 * carrying its Bold "just in case" was two thirds of the font payload for
 * nothing. Add a weight here when a card draws with it.
 */
const font = (rel: string): string => fileURLToPath(import.meta.resolve(`../fonts/${rel}`));

/**
 * Deliberately structural rather than a `FontInput[]`: `platform.og` owns that
 * type, and a design package that imported it to describe its own files would
 * make the artwork depend on the renderer. `defineOgConfig` accepts this shape.
 */
export const ogFonts = [
  {
    /** `--font-display`. The wordmark, and any card title. */
    name: "Barlow Condensed",
    weight: 700,
    style: "normal",
    path: font("barlow-condensed/BarlowCondensed-Bold.ttf"),
  },
  {
    /** `--font-mono`. Eyebrows, identifiers, anything set as evidence. */
    name: "Iosevka",
    weight: 400,
    style: "normal",
    path: font("iosevka/Iosevka-Regular.ttf"),
  },
] as const satisfies readonly {
  name: string;
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style: "normal" | "italic";
  path: string;
}[];
