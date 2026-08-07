/**
 * The brand surface: the ONE file to edit to reskin the mark. Nothing else
 * under `./logo` carries brand text, geometry or a hex value.
 *
 * `ogColors` must stay literal hex rather than a CSS custom property: satori,
 * which renders the OG images, cannot resolve `var(--color-*)`.
 */

/** Which surface the mark is drawn on, which is what picks its stroke. */
export type LogoColorScheme =
  | "primary"
  | "light"
  | "mono-light"
  | "mono-dark"
  | "on-destructive"
  | "on-success";

/**
 * The grounds a social card is drawn on, as literal hex for the same reason as
 * `ogColors` — satori resolves no custom property, so a card cannot read the
 * semantic palette and these values cannot be derived from it at render time.
 *
 * They MIRROR `darkPalette`/`lightPalette` in `../tokens/brand.ts` rather than
 * introducing new colour: `dark.bg` is the garment black the site renders on
 * and `light.bg` is proof paper. A reskin edits both files, and the contrast
 * audit covers the tokens these were taken from.
 */
export interface LogoOgSurface {
  /** Card ground. */
  bg: string;
  /** Wordmark and title. */
  text: string;
  /** Eyebrow, tagline, and any secondary line. */
  muted: string;
  /** The scheme `LogoIcon` is drawn with on this ground. */
  scheme: LogoColorScheme;
}

export interface LogoBrand {
  /** Full wordmark. */
  wordmarkFull: string;
  /** Short wordmark (initials/abbreviation). */
  wordmarkShort: string;
  /** Accessible name for the icon mark (`aria-label`). */
  ariaLabel: string;
  /** The two literal stroke colors every scheme below derives from. */
  ogColors: {
    /** Stroke for dark/filled surfaces. */
    primary: string;
    /** Stroke for light surfaces. */
    light: string;
  };
  /** The two grounds `platform.og` cards are composed on. */
  ogSurfaces: {
    dark: LogoOgSurface;
    light: LogoOgSurface;
  };
}

export const brand: LogoBrand = {
  wordmarkFull: "somewhatintelligent",
  wordmarkShort: "si*",
  ariaLabel: "somewhatintelligent",
  ogColors: {
    primary: "#F7F7F3",
    light: "#080908",
  },
  ogSurfaces: {
    /** `neutral.950` ground, `neutral.50` type — what every public page renders as. */
    dark: { bg: "#080908", text: "#F7F7F3", muted: "#81817A", scheme: "primary" },
    /** `neutral.50` ground, `neutral.950` type — the icon plate, which must read on a light tab bar. */
    light: { bg: "#F7F7F3", text: "#080908", muted: "#60605A", scheme: "light" },
  },
};

/** Mark stroke per scheme. Every entry resolves to one of `brand.ogColors`. */
export const MARK_STROKE: Record<LogoColorScheme, string> = {
  primary: brand.ogColors.primary,
  light: brand.ogColors.light,
  "mono-light": brand.ogColors.primary,
  "mono-dark": brand.ogColors.light,
  "on-destructive": brand.ogColors.primary,
  "on-success": brand.ogColors.primary,
};

/**
 * The mark is the FRIEND declaration's asterisk: a footnote, wildcard, and
 * pointer to the material that complicates the public statement.
 */
export const markPaths = {
  circleRadius: 0,
  ticks: ["M12 4v16", "M4 12h16", "M6.4 6.4l11.2 11.2", "M17.6 6.4L6.4 17.6"],
  centerRadius: 1.15,
};
