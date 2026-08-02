import type { LogoColorScheme } from "./types";

/**
 * ── Consumer-edited brand surface ──
 *
 * This is the ONE file a downstream consumer edits to reskin the logo:
 * wordmark strings, the accessible name, and the mark's geometry/colors.
 * Every other file under `./logo/*` reads only from here — no brand text,
 * shape, or hex belongs anywhere else in this directory.
 *
 * `ogColors` MUST stay literal hex (not a CSS custom property): satori
 * (used for OG image generation) cannot resolve `var(--color-*)`.
 */
export interface LogoBrand {
  /** Full wordmark — `horizontal` and `compact` layouts. */
  wordmarkFull: string;
  /** Short wordmark (initials/abbreviation) — the `stacked` layout. */
  wordmarkShort: string;
  /** Accessible name for the icon mark (`aria-label`). */
  ariaLabel: string;
  /** Literal hex stroke colors the mark renders with on light vs. dark
   *  surfaces. Every `LogoColorScheme` combination derives from these two. */
  ogColors: {
    /** Stroke color for dark/filled surfaces. */
    primary: string;
    /** Stroke color for light surfaces. */
    light: string;
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
};

/** Mark stroke color per `LogoColorScheme`, derived from `brand.ogColors`. */
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
