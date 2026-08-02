/**
 * Radius Tokens
 *
 * The system is assembled from proof sheets, rules, labels, and black glass.
 * Corners are nearly square; rounding communicates a physical control or a
 * truly circular object, never generic friendliness.
 */

export const radius = {
  /** No rounding — for full-bleed edges only */
  none: 0,
  /** Tight rounding — chips, tiny controls, inline tags */
  xs: 1,
  /** Default controls and small surfaces. */
  sm: 2,
  /** Cards, sheets, menus. */
  md: 3,
  /** Large cards and media frames. */
  lg: 4,
  /** Hero panels and feature backdrops. */
  xl: 6,
  /** Pills — avatars, toggles, segmented controls, fully-round chips */
  full: 9999,
} as const;
