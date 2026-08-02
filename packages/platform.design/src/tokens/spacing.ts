/**
 * Platform Spacing Tokens
 *
 * Tailwind's default --spacing: 0.25rem handles the base scale (p-4 → 16px).
 * We only define semantic responsive spacings and layout widths here.
 */

// ============================================
// Semantic Responsive Spacings — clamp-based
// Generates --spacing-page, --spacing-section, --spacing-grid
// ============================================

export interface FluidSpacing {
  min: number;
  preferred: string;
  max: number;
}

export const semanticSpacing = {
  /** Page padding — horizontal + vertical outer padding */
  page: { min: 24, preferred: "5vw", max: 48 },
  /** Section margin — vertical space between major sections */
  section: { min: 24, preferred: "4vw", max: 48 },
  /** Grid gap — space between cards/items in a grid */
  grid: { min: 12, preferred: "2vw", max: 20 },
} as const satisfies Record<string, FluidSpacing>;

// ============================================
// Layout Widths
// ============================================

export const layout = {
  /** Max width for long-form prose/article content → --container-prose
   *  Responsive: grows with viewport, capped at 960px on large screens */
  prose: { min: 320, preferred: "75vw", max: 960 },
  /** Max width for main content area → --container-content */
  content: 1100,
} as const;
