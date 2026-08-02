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
