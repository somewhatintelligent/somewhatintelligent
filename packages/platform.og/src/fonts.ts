import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type FontStyle = "normal" | "italic";

export type SatoriFont = {
  name: string;
  weight: FontWeight;
  style: FontStyle;
  data: Buffer;
};

/**
 * A consumer-declared font: either the bytes directly, or a filesystem path
 * resolved against the consumer's directory.
 *
 * THERE IS NO SHIPPED FONT SET, and that is the point of the type. satori
 * resolves neither `@font-face` nor a CSS custom property — it takes font BYTES
 * and nothing else — so the design package's `fonts.css` is invisible here and
 * every consumer has to hand over the files it actually draws with. A consumer
 * whose definitions render no text declares none.
 */
export type FontInput = { name: string; weight: FontWeight; style: FontStyle } & (
  | { data: Buffer; path?: never }
  | { path: string; data?: never }
);

/** Resolves consumer-declared `FontInput[]` into satori-ready `SatoriFont[]`. */
export async function loadFonts(
  fonts: readonly FontInput[],
  cwd: string = process.cwd(),
): Promise<SatoriFont[]> {
  return Promise.all(
    fonts.map(async (font) => ({
      name: font.name,
      weight: font.weight,
      style: font.style,
      data: font.data ?? (await readFile(resolve(cwd, font.path))),
    })),
  );
}
