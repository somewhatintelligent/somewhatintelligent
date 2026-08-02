/**
 * Semantic Color Tokens
 *
 * This file is the palette→semantic mapping layer: it reads the literal
 * color values from src/tokens/brand.ts (the only file with hex/HSL
 * literals) and shapes them into the fixed semantic contract every
 * component in `@si/ui` is written against — background/foreground,
 * card, popover, primary(+hover), secondary, muted, accent,
 * destructive(+hover), success, warning, border(+strong), input, ring,
 * surface-sunken/raised, inverse, chart-1..5, and the sidebar set.
 *
 * Retinting a brand means editing src/tokens/brand.ts ONLY — this file
 * has no literals to touch. If you add a new semantic slot, add its field
 * to both `lightTheme` and `darkTheme` (never one without the other) and
 * teach scripts/codegen.ts + scripts/audit-contrast.ts about it.
 */

import {
  hsl,
  lightPalette,
  darkPalette,
  functionalColors,
  neutralRamp,
  accentRamp,
  type HSLColor,
} from "./brand";

export type { HSLColor };
export { hsl, neutralRamp, accentRamp };

export interface SemanticTheme {
  background: HSLColor;
  foreground: HSLColor;
  card: HSLColor;
  cardForeground: HSLColor;
  popover: HSLColor;
  popoverForeground: HSLColor;
  primary: HSLColor;
  primaryForeground: HSLColor;
  primaryHover: HSLColor;
  secondary: HSLColor;
  secondaryForeground: HSLColor;
  muted: HSLColor;
  mutedForeground: HSLColor;
  accent: HSLColor;
  accentForeground: HSLColor;
  destructive: HSLColor;
  destructiveForeground: HSLColor;
  destructiveHover: HSLColor;
  success: HSLColor;
  successForeground: HSLColor;
  warning: HSLColor;
  warningForeground: HSLColor;
  border: HSLColor;
  borderStrong: HSLColor;
  input: HSLColor;
  ring: HSLColor;
  surfaceSunken: HSLColor;
  surfaceRaised: HSLColor;
  inverse: HSLColor;
  inverseForeground: HSLColor;
  chart1: HSLColor;
  chart2: HSLColor;
  chart3: HSLColor;
  chart4: HSLColor;
  chart5: HSLColor;
  sidebar: HSLColor;
  sidebarForeground: HSLColor;
  sidebarPrimary: HSLColor;
  sidebarPrimaryForeground: HSLColor;
  sidebarAccent: HSLColor;
  sidebarAccentForeground: HSLColor;
  sidebarBorder: HSLColor;
  sidebarRing: HSLColor;
}

export const lightColors: SemanticTheme = {
  background: lightPalette.bg,
  foreground: lightPalette.text,
  card: lightPalette.surfaceRaised,
  cardForeground: lightPalette.text,
  popover: lightPalette.surfaceRaised,
  popoverForeground: lightPalette.text,
  primary: functionalColors.primary.light,
  primaryForeground: lightPalette.textOnDark,
  primaryHover: functionalColors.primary.lightHover,
  secondary: lightPalette.surfaceSunken,
  secondaryForeground: lightPalette.text,
  muted: lightPalette.surfaceSunken,
  mutedForeground: lightPalette.textSecondary,
  accent: lightPalette.surfaceSunken,
  accentForeground: lightPalette.text,
  destructive: functionalColors.destructive.light,
  destructiveForeground: lightPalette.textOnDark,
  destructiveHover: functionalColors.destructive.lightHover,
  success: functionalColors.success.light,
  successForeground: lightPalette.textOnDark,
  warning: functionalColors.warning.light,
  warningForeground: lightPalette.textOnLight,
  border: lightPalette.border,
  borderStrong: lightPalette.borderStrong,
  input: lightPalette.border,
  ring: functionalColors.primary.light,
  surfaceSunken: lightPalette.surfaceSunken,
  surfaceRaised: lightPalette.surfaceRaised,
  inverse: lightPalette.text,
  inverseForeground: lightPalette.bg,
  chart1: functionalColors.primary.light,
  chart2: functionalColors.success.light,
  chart3: functionalColors.warning.light,
  chart4: functionalColors.destructive.light,
  chart5: lightPalette.textSecondary,
  sidebar: lightPalette.surface,
  sidebarForeground: lightPalette.text,
  sidebarPrimary: functionalColors.primary.light,
  sidebarPrimaryForeground: lightPalette.textOnDark,
  sidebarAccent: lightPalette.surfaceSunken,
  sidebarAccentForeground: lightPalette.text,
  sidebarBorder: lightPalette.border,
  sidebarRing: functionalColors.primary.light,
};

export const darkColors: SemanticTheme = {
  background: darkPalette.bg,
  foreground: darkPalette.text,
  card: darkPalette.surfaceRaised,
  cardForeground: darkPalette.text,
  popover: darkPalette.surfaceRaised,
  popoverForeground: darkPalette.text,
  primary: functionalColors.primary.dark,
  primaryForeground: darkPalette.textOnLight,
  primaryHover: functionalColors.primary.darkHover,
  secondary: darkPalette.surfaceRaised,
  secondaryForeground: darkPalette.text,
  muted: darkPalette.surfaceRaised,
  mutedForeground: darkPalette.textSecondary,
  accent: darkPalette.surfaceRaised,
  accentForeground: darkPalette.text,
  destructive: functionalColors.destructive.dark,
  destructiveForeground: darkPalette.textOnLight,
  destructiveHover: functionalColors.destructive.darkHover,
  success: functionalColors.success.dark,
  successForeground: darkPalette.textOnLight,
  warning: functionalColors.warning.dark,
  warningForeground: darkPalette.textOnLight,
  border: darkPalette.border,
  borderStrong: darkPalette.borderStrong,
  input: darkPalette.border,
  ring: functionalColors.primary.dark,
  surfaceSunken: darkPalette.surfaceSunken,
  surfaceRaised: darkPalette.surfaceRaised,
  inverse: darkPalette.text,
  inverseForeground: darkPalette.bg,
  chart1: functionalColors.primary.dark,
  chart2: functionalColors.success.dark,
  chart3: functionalColors.warning.dark,
  chart4: functionalColors.destructive.dark,
  chart5: darkPalette.textSecondary,
  sidebar: darkPalette.surface,
  sidebarForeground: darkPalette.text,
  sidebarPrimary: functionalColors.primary.dark,
  sidebarPrimaryForeground: darkPalette.textOnLight,
  sidebarAccent: darkPalette.surfaceRaised,
  sidebarAccentForeground: darkPalette.text,
  sidebarBorder: darkPalette.border,
  sidebarRing: functionalColors.primary.dark,
};

// ============================================
// Effects — flat, zero-blur "glass" slot kept for API compatibility.
// Derived from the theme surfaces above rather than its own literals.
// ============================================

export const effectColors = {
  glass: {
    light: {
      bg: `hsl(${lightColors.surfaceRaised.hsl})`,
      border: `hsl(${lightColors.border.hsl})`,
    },
    dark: {
      bg: `hsl(${darkColors.surfaceRaised.hsl})`,
      border: `hsl(${darkColors.border.hsl})`,
    },
    blur: "0px",
  },
} as const;

// ============================================
// Raw ramp → flat [cssName, hex] pairs for illustration/OG utilities
// (bg-neutral-900, text-accent-500, …). Never used by the semantic theme
// objects above — theme-invariant, exact-hex only.
// ============================================

export function rawPaletteEntries(): [string, string][] {
  const ramp = (prefix: string, r: Record<string, string>): [string, string][] =>
    Object.entries(r).map(([step, hex]) => [`${prefix}-${step}`, hex]);

  return [...ramp("neutral", neutralRamp), ...ramp("accent", accentRamp)];
}

/**
 * Deterministic light-from-dark inversion, kept for tooling/back-compat.
 */
export function invertForLight(color: HSLColor): HSLColor {
  const l = Math.min(97, Math.max(3, 100 - color.l));
  const s = Math.round(color.s * 0.9);
  return hsl(color.h, s, l);
}
