/**
 * Typography Tokens
 *
 * Single source of truth for all type definitions.
 * Codegen reads these to produce CSS utilities and custom properties.
 *
 * FONT SURFACE — consumer-swappable. `fontStacks` below and the
 * `@font-face` declarations in src/fonts.css are the shipped defaults
 * (Barlow Condensed for display, Source Serif 4 for body/editorial, and
 * Iosevka for mono), not a
 * fixed brand identity. To swap typefaces: replace the vendored font
 * files under src/fonts/, update the `@font-face` blocks in
 * src/fonts.css, and repoint the `family` strings below — the `cssName`
 * keys (`--font-display`, `--font-body`, …) are the stable contract the
 * rest of the system and `@si/ui` components are written against;
 * keep those the same shape even if the actual typefaces change.
 */

// Font stack definitions — CSS var names + actual font family values
export const fontStacks = {
  /** Barlow Condensed — claims, page titles, release identifiers. */
  display: { cssName: "display", family: "'Barlow Condensed', 'Arial Narrow', sans-serif" },
  /** Source Serif 4 — readable UI copy with an editorial edge. */
  body: { cssName: "body", family: "'Source Serif 4', Georgia, serif" },
  /** Source Serif 4 — long-form reading. */
  editorial: { cssName: "editorial", family: "'Source Serif 4', Georgia, serif" },
  /** Editorial headings stay in the same serif family. */
  editorialDisplay: {
    cssName: "editorial-display",
    family: "'Source Serif 4', Georgia, serif",
  },
  /** Source Serif italic — the private editorial correction. */
  accent: { cssName: "accent", family: "'Source Serif 4', Georgia, serif" },
  /** Iosevka — monospace. `font-mono`. */
  mono: { cssName: "mono", family: "'Iosevka', ui-monospace, 'SF Mono', monospace" },
} as const;

// ============================================
// Fluid Type — clamp-based, scales with viewport
// For display headlines, editorial prose, hero moments
// ============================================

export interface FluidTypeToken {
  min: number;
  preferred: string;
  max: number;
  weight: number;
  leading: number;
  tracking: number;
  font: keyof typeof fontStacks;
  style?: "italic";
}

export const fluidType = {
  /** Brand hero splash — compressed, confrontational display. */
  hero: {
    min: 80,
    preferred: "14vw",
    max: 200,
    weight: 700,
    leading: 0.82,
    tracking: -0.035,
    font: "display",
  },
  /** Main page heading — Dashboard, Settings, etc. */
  pageTitle: {
    min: 32,
    preferred: "5vw",
    max: 56,
    weight: 700,
    leading: 0.88,
    tracking: -0.025,
    font: "display",
  },
  /** Dashboard stat numbers — big light numerals */
  stat: {
    min: 28,
    preferred: "4vw",
    max: 48,
    weight: 700,
    leading: 0.9,
    tracking: 0,
    font: "display",
  },
  /** Card display heading, consent screen title, episode title */
  displayTitle: {
    min: 24,
    preferred: "3vw",
    max: 36,
    weight: 700,
    leading: 0.95,
    tracking: -0.015,
    font: "display",
  },
  /** Blog post / article h1 */
  editorialH1: {
    min: 36,
    preferred: "7vw",
    max: 72,
    weight: 500,
    leading: 0.98,
    tracking: -0.02,
    font: "editorialDisplay",
  },
  /** Blog post / article h2 */
  editorialH2: {
    min: 28,
    preferred: "4vw",
    max: 42,
    weight: 500,
    leading: 1.1,
    tracking: 0,
    font: "editorialDisplay",
  },
  /** Blog post / article h3 */
  editorialH3: {
    min: 22,
    preferred: "3vw",
    max: 30,
    weight: 500,
    leading: 1.2,
    tracking: 0,
    font: "editorialDisplay",
  },
  /** Long-form article body text. */
  editorialBody: {
    min: 16,
    preferred: "2vw",
    max: 19,
    weight: 400,
    leading: 1.75,
    tracking: 0,
    font: "editorial",
  },
  /** Article opening paragraph — Source Serif italic. */
  editorialLede: {
    min: 18,
    preferred: "2.5vw",
    max: 22,
    weight: 400,
    leading: 1.7,
    tracking: 0,
    font: "editorial",
    style: "italic",
  },
  /** Pull quote — light italic, ink colored */
  pullquote: {
    min: 24,
    preferred: "4vw",
    max: 40,
    weight: 400,
    leading: 1.32,
    tracking: 0,
    font: "editorial",
    style: "italic",
  },
} as const satisfies Record<string, FluidTypeToken>;

// ============================================
// Fixed Type — discrete sizes, for UI chrome
// Section markers, labels, code
// ============================================

export interface FixedTypeToken {
  size: number;
  weight: number;
  leading: number;
  tracking: number;
  font?: keyof typeof fontStacks;
  transform?: "uppercase";
}

export const fixedType = {
  /** Mono metadata label — timestamps, table headers, field labels */
  monoLabel: {
    size: 11,
    weight: 400,
    leading: 1,
    tracking: 0.06,
    font: "mono",
    transform: "uppercase",
  },
  /** Code blocks, inline code */
  code: {
    size: 14,
    weight: 400,
    leading: 1.6,
    tracking: 0,
    font: "mono",
  },
  /** Section label — story headers, form section dividers, category markers */
  sectionLabel: {
    size: 15,
    weight: 700,
    leading: 1.5,
    tracking: 0.05,
    transform: "uppercase",
  },
} as const satisfies Record<string, FixedTypeToken>;

// ============================================
// UI Type Scale — body font sizes
// These map to Tailwind's text-* but with our leading
// ============================================

export interface UITypeToken {
  size: number;
  leading: number;
}

export const uiType = {
  /** Mono labels, tiny metadata — system minimum */
  "2xs": { size: 11, leading: 1.5 },
  /** Kbd, shortcut hints, tertiary metadata */
  xs: { size: 13, leading: 1.5 },
  /** Descriptions, menu items, compact body, button default */
  sm: { size: 15, leading: 1.5 },
  /** Default body, inputs, labels */
  base: { size: 16, leading: 1.5 },
  /** Card compact titles, emphasized body */
  lg: { size: 18, leading: 1.5 },
  /** Dialog titles, section headings */
  xl: { size: 20, leading: 1.4 },
} as const satisfies Record<string, UITypeToken>;

// ============================================
// Custom Leading (line-height)
// Named values for Tailwind --leading-* namespace
// ============================================

export const customLeading = {
  /** Display hero — extremely tight */
  display: 0.9,
  /** Display headings — very tight */
  "display-tight": 0.95,
  /** Section/card headings */
  heading: 1.1,
  /** Editorial headings */
  "heading-loose": 1.2,
  /** Pull quotes */
  pullquote: 1.3,
  /** Editorial lede */
  "editorial-lede": 1.7,
  /** Editorial body — very open */
  editorial: 1.75,
} as const;

// ============================================
// Custom Tracking (letter-spacing)
// Named values for Tailwind --tracking-* namespace
// ============================================

export const customTracking = {
  /** Hero display — very tight */
  display: "-0.03em",
  /** Page titles, stats — tight */
  "display-tight": "-0.02em",
  /** Section headings — slightly tight */
  heading: "-0.01em",
  /** Uppercase labels, mono labels */
  caps: "0.06em",
} as const;
