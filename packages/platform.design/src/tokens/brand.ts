/**
 * BRAND SURFACE — the one file a consumer edits to reskin this template.
 *
 * Everything below is a literal color value. Nothing elsewhere in this
 * package (src/tokens/colors.ts, scripts/codegen.ts, generated/css/*)
 * hardcodes a hex or HSL literal — they all resolve through the values
 * exported here. Retint a brand by editing the numbers in this file, then
 * run `bun run codegen && bun run audit:contrast` (see README.md).
 *
 * Two layers:
 *   1. RAMPS (`neutralRamp`, `accentRamp`) — theme-invariant hex steps for
 *      illustration surfaces (OG images, charts) that want an exact value
 *      without re-deriving one. Keep the same step keys (50..950) so
 *      codegen's iteration keeps working after a retint.
 *   2. THEME VALUES (`lightPalette`, `darkPalette`, `functionalColors`) —
 *      theme-aware HSL values, hand-tuned per mode so `bun run
 *      audit:contrast` can hit WCAG AA. Adjust H/S/L here, not in colors.ts.
 *
 * somewhatintelligent is a publishing system for objects, software, and
 * writing. Its material language comes from black cotton, cold proof paper,
 * steel rules, terminal evidence, and one private pink correction. The
 * neutral ramp therefore stays nearly achromatic: paper at one end, garment
 * black at the other. Pink is a scarce authorial mark and the primary action
 * color, never a wash or gradient. Destructive/success/warning retain their
 * conventional hues so state is legible before it is stylish.
 *
 * FONTS are a separate swap point — see the doc comments in
 * src/tokens/typography.ts (`fontStacks`) and src/fonts.css.
 */

export interface HSLColor {
  hsl: string;
  h: number;
  s: number;
  l: number;
  hex: string;
}

export function hsl(h: number, s: number, l: number): HSLColor {
  return { hsl: `${h} ${s}% ${l}%`, h, s, l, hex: hslToHex(h, s, l) };
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ============================================
// RAMPS — exact hex, theme-invariant.
// Namespaced so they never collide with the semantic vars codegen also
// emits (semantic `--color-primary` (theme-aware) vs raw `--color-accent-500`).
// Never reference these in product UI chrome — semantic tokens only.
// ============================================

/** Cold proof paper → garment black. */
export const neutralRamp = {
  50: "#F7F7F3",
  100: "#F1F1EC",
  200: "#E2E2DB",
  300: "#CACAC1",
  400: "#A3A39B",
  500: "#81817A",
  600: "#60605A",
  700: "#41413D",
  800: "#282826",
  900: "#151514",
  950: "#080908",
} as const;

/** Signal pink — the private correction crossing a public interface. */
export const accentRamp = {
  50: "#FFF0F7",
  100: "#FFDCEB",
  200: "#FFB9D7",
  300: "#FF8FC2",
  400: "#FF68AE",
  500: "#FF4FA3",
  600: "#E62A84",
  700: "#BC1768",
  800: "#92104F",
  900: "#680C39",
  950: "#400722",
} as const;

// ============================================
// THEME VALUES — hand-tuned HSL, contrast-audited (bun run audit:contrast)
// ============================================

/** Light mode is cold proof paper, not warm lifestyle cream. */
export const lightPalette = {
  bg: hsl(60, 10, 94),
  surface: hsl(60, 12, 97),
  surfaceRaised: hsl(60, 14, 99),
  surfaceSunken: hsl(60, 7, 89),
  border: hsl(60, 4, 48),
  borderStrong: hsl(60, 4, 24),
  text: hsl(60, 5, 4),
  textSecondary: hsl(60, 3, 31),
  textTertiary: hsl(60, 2, 42),
  /** Text sat on top of a bright/light accent fill (e.g. warning). */
  textOnLight: hsl(60, 5, 4),
  /** Text sat on top of a solid/dark accent fill (e.g. primary, destructive). */
  textOnDark: hsl(60, 12, 97),
} as const;

/** Dark mode is the black garment and black-glass evidence table. */
export const darkPalette = {
  bg: hsl(60, 4, 3),
  surface: hsl(60, 3, 6),
  surfaceRaised: hsl(60, 3, 9),
  surfaceSunken: hsl(60, 3, 1),
  border: hsl(60, 3, 46),
  borderStrong: hsl(60, 4, 65),
  text: hsl(60, 12, 95),
  textSecondary: hsl(60, 6, 74),
  textTertiary: hsl(60, 4, 56),
  textOnLight: hsl(60, 5, 4),
  textOnDark: hsl(60, 12, 95),
} as const;

/**
 * Functional accents — primary (the brand slot) + the conventional
 * destructive/success/warning triad, tuned as a syntax-highlighter palette:
 * pink keyword, red error, green success, amber warning. Each carries a
 * light-mode value/hover and a dark-mode value/hover, independently tuned
 * for contrast against their respective theme's surfaces.
 */
export const functionalColors = {
  /** THE brand slot — the `friend` keyword pink. Buttons, links, focus
   *  rings, active states, charts. Deep saturated pink fill with near-white
   *  text in light mode; bright chalk pink with near-black text in dark
   *  mode (mirrors the shirt's pink-on-black). */
  primary: {
    light: hsl(330, 79, 40),
    lightHover: hsl(330, 85, 33),
    dark: hsl(330, 95, 70),
    darkHover: hsl(330, 100, 78),
  },
  /** Destructive / danger. Terminal red — its own hue, never confusable
   *  with the pink primary. */
  destructive: {
    light: hsl(0, 70, 45), // ~4.8:1 with near-white text
    lightHover: hsl(0, 75, 38),
    dark: hsl(0, 85, 68),
    darkHover: hsl(0, 90, 75),
  },
  /** Positive / confirmation. Terminal green — the "tests passed" color. */
  success: {
    light: hsl(142, 65, 28),
    lightHover: hsl(142, 70, 22),
    dark: hsl(142, 60, 62),
    darkHover: hsl(142, 65, 70),
  },
  /** Attention / pending. Terminal amber — tuned as a light tone in BOTH
   *  themes so it pairs with dark text under this template's fixed
   *  warning/warningForeground contract (see file header). */
  warning: {
    light: hsl(36, 85, 38),
    lightHover: hsl(36, 82, 32),
    dark: hsl(45, 90, 68),
    darkHover: hsl(45, 92, 75),
  },
} as const;
