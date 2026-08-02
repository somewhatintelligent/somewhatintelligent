/**
 * Shared Material Language Styles — somewhatintelligent
 *
 * Surfaces are proof sheets and black-glass evidence tables: flat canvas,
 * crisp rules, nearly square corners.
 * There is NO diffused shadow and NO blur anywhere — depth is drawn with
 * border treatment and hard-offset lines:
 *
 *   solid rule    — primary surface / strongest emphasis
 *   dashed rule   — secondary / interactive affordance (dashes invite touch)
 *   dotted rule   — tertiary / hints / dividers
 *   brutal offset — a hard offset (--brutal-*), the "duplicate line" that
 *                   stands a surface off the canvas
 *
 * The four material keys (brutal / soft / neo / glass) are kept for
 * backwards compatibility with every consumer:
 *   brutal — the signature: solid rule + hard offset
 *   soft   — quiet secondary: dashed rule, no offset
 *   neo    — chiseled toggle surfaces (hard 0-blur chisel)
 *   glass  — LEGACY name; renders as an opaque fresh sheet + solid rule
 *
 * Surface = static containers (cards, alerts).
 * Interactive = elements with hover/active states (buttons, badges).
 */

// ============================================
// Surface materials — for static containers
// ============================================

// Cards/surfaces round on the `md` (Cards) radius token, not `sm` (small
// controls) — so a brand's "Cards, menus" radius knob (--radius-md) reaches
// every composed card. The Card primitive base is already rounded-md; these
// material strings are appended last in cn()/twMerge, so they must match or
// they silently downgrade every card back to the control radius.
export const surfaceMaterials = {
  /** Signature: solid rule + hard offset — the default card */
  brutal: "rounded-md bg-card border border-border-strong shadow-brutal-sm",
  /** Soft: quiet secondary sheet — dashed rule, flat */
  soft: "rounded-md border border-dashed border-border bg-surface-raised",
  /** Neo raised: chiseled, standing proud of the canvas */
  neo: "rounded-md border border-border bg-surface-raised shadow-neo-raised",
  /** Neo inset: pressed/sunken into the canvas */
  neoInset: "rounded-md border border-border bg-surface-sunken shadow-neo-inset",
  /** Legacy "glass": an opaque fresh sheet with a solid rule (flat) */
  glass: "rounded-md glass",
} as const;

// ============================================
// Interactive materials — with hover/active states
// ============================================

export const interactiveMaterials = {
  /** Signature: offset that grows on hover and collapses on press —
   *  the element physically sits down on the canvas. Card-tile interaction —
   *  consumed only by clickable card surfaces (never buttons/badges), so it
   *  rounds on the `md` Cards token like the surfaces. */
  brutal:
    "rounded-md border border-border-strong shadow-brutal-sm transition-all hover:shadow-brutal-md hover:-translate-x-0.5 hover:-translate-y-0.5 active:shadow-none active:translate-x-0.5 active:translate-y-0.5",
  /** Soft: dashed affordance that commits to a solid rule on hover */
  soft: "rounded-sm border border-dashed border-border transition-colors hover:[border-style:solid] hover:border-border-strong active:press-in",
  /** Neo: chisel flips inset on active */
  neo: "rounded-sm border border-border shadow-neo-raised hover:shadow-neo-inset active:shadow-neo-inset active:press-in",
  /** Legacy "glass": flat sheet; rule strengthens on hover */
  glass: "rounded-sm glass transition-colors hover:border-border-strong active:press-in",
} as const;

// ============================================
// Compact materials — for small elements (badges)
// ============================================

export const compactMaterials = {
  /** Solid rule + tiny hard offset */
  brutal: "border border-border-strong shadow-brutal-sm",
  /** Legacy "glass": opaque sheet chip with a solid rule */
  glass: "glass",
} as const;

export type SurfaceMaterial = keyof typeof surfaceMaterials;
export type InteractiveMaterial = keyof typeof interactiveMaterials;
export type CompactMaterial = keyof typeof compactMaterials;
