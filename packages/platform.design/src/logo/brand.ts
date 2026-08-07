/**
 * The brand surface: the ONE file to edit to reskin the mark. Nothing else
 * under `./logo` carries brand text, geometry or a hex value.
 *
 * `ogColors` must stay literal hex rather than a CSS custom property: satori,
 * which renders the OG images, cannot resolve `var(--color-*)`.
 */
import { neutralRamp } from "../tokens/brand.ts";

/** Which surface the mark is drawn on, which is what picks its stroke. */
export type LogoColorScheme =
  | "primary"
  | "light"
  | "mono-light"
  | "mono-dark"
  | "on-destructive"
  | "on-success";

/**
 * The ground a social card is drawn on.
 *
 * TAKEN FROM `neutralRamp` RATHER THAN RETYPED. satori resolves no CSS custom
 * property, so a card needs concrete hex — but "concrete at render time" and
 * "typed out by hand" are different things, and the ramp is already exact hex
 * in this same package. Importing it means a reskin that moves the ramp moves
 * the cards, instead of leaving four values behind for someone to notice.
 *
 * (`ogColors` above predates this and still carries its own literals. It is
 * left alone because `MARK_STROKE` is built from it and the two are read by
 * client code; folding them in is a separate edit with a wider blast radius.)
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
  /**
   * The ground `platform.og` cards are composed on.
   *
   * ONE, not a light/dark pair. Every card this brand publishes — the social
   * card, the favicon, the home-screen tile — is drawn on the garment black the
   * site itself renders on, and a solid dark tile reads on a light tab bar
   * anyway. A second surface with no card drawing on it is a value that goes
   * stale unobserved; add it back when something needs it.
   */
  ogSurfaces: {
    dark: LogoOgSurface;
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
    /** Garment black ground, proof-paper type — what every public page renders as. */
    dark: {
      bg: neutralRamp[950],
      text: neutralRamp[50],
      muted: neutralRamp[500],
      scheme: "primary",
    },
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
