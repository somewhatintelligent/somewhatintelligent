# Design System — somewhatintelligent

**A publishing apparatus, not a themed dashboard.** The system joins black
cotton, cold proof paper, steel rules, editorial type, and terminal evidence.
Nothing glows or blurs. Depth is drawn with rules and occasional hard-offset
lines. Signal pink is a scarce private correction crossing a public record,
not ambient decoration.

This document is the contract. Every component in `platform.ui`, every app
surface, and every future agent run is held to it.

---

## 1. The five rules

1. **Cold neutral canvas, one signal.** A nearly achromatic paper/garment
   ramp for backgrounds, surfaces, and text, plus signal-pink `primary` and
   the conventional `destructive` / `success` / `warning` triad. See
   src/tokens/brand.ts for the literal values and src/tokens/colors.ts for
   the full semantic token contract.
2. **No soft shadows. No blur. Ever.** `box-shadow` blur radii are 0
   everywhere (the generated `--soft-*`/`--neo-*` variables resolve to
   hard lines), `backdrop-filter` does not exist, and the legacy `glass`
   utility renders an opaque sheet with a solid rule.
3. **Depth is border treatment.**
   | Treatment                                          | Meaning                                                                    |
   | -------------------------------------------------- | -------------------------------------------------------------------------- |
   | `border-solid` (+ `border-border-strong`, 1.5–2px) | primary surface, strongest emphasis, success/confirmed                     |
   | `border-dashed`                                    | secondary surface, interactive affordance, warning/pending                 |
   | `border-dotted`                                    | tertiary, hints, dividers, informational                                   |
   | `shadow-brutal-*`                                  | a hard offset — the "duplicate line" that stands a card/CTA off the canvas |
4. **Nearly square.** The radius scale runs from 0–6px. Controls default to
   2px and cards to 3px; only switches, radio controls, and avatars should be
   fully round.
5. **Three distinct voices.** Barlow Condensed makes public claims and
   release identifiers. Source Serif 4 carries interface copy and long-form
   reading. Iosevka carries IDs, timestamps, code, and terse state labels.

## 2. Palette

The full semantic token contract (theme-aware, from `src/tokens/colors.ts`
→ codegen) is documented in README.md — background/foreground, card,
popover, primary(+hover), secondary, muted, accent, destructive(+hover),
success, warning, border(+strong), input, ring, surface-sunken/-raised,
inverse, chart-1..5, and the sidebar set. Every name in that contract is
the only vocabulary component source (`platform.ui`) may use for color.

Raw theme-invariant ramps for illustration/OG surfaces: `--color-neutral-*`,
`--color-accent-*` (src/tokens/brand.ts). Never use raw steps for product
UI chrome — semantic tokens only (enforced by `bun run brand-lint
--strict-semantic` on ui component directories).

Contrast is enforced: `bun run audit:contrast` in `packages/design` must
report zero WCAG-AA failures (run automatically by `bun run build`).

## 3. Shadows are lines

The four generated shadow families survive by name, hard-edged by value:

- `shadow-brutal-sm|md|lg` — `Xpx Ypx 0 var(--color-border-strong)`. THE
  elevation effect. Interactive form: offset grows on hover, collapses on
  press (`interactiveMaterials.brutal` — the element sits down on the canvas).
- `shadow-soft-*` — legacy name; now a single hard 0-blur rule. Prefer
  borders in new code.
- `shadow-neo-*` — hard 0-blur chisel for toggle-like controls.
- `glass` utility / `--glass-*` — legacy name; opaque sheet + solid rule.
- `--shadow-brand` — alias of `--brutal-md`. There is no glow.

## 4. Material language (`platform.ui/lib/materials`)

`surfaceMaterials` / `interactiveMaterials` / `compactMaterials` encode the
grammar once; components compose them. Key mapping: `brutal` = solid rule +
signature offset, `soft` = dashed rule (quiet secondary; dashes
commit to solid on hover), `neo` = chisel, `glass` = opaque sheet.

## 5. Component conventions

- **Buttons**: tight 2px proof controls. `default`/`strong` = solid primary fill (strong
  adds the signature offset); `outline` = 1.5px heavy rule; `link` = dotted
  underline that commits to solid on hover; `destructive` = the destructive
  token. Focus is a 2px solid ring, offset — never a glow.
- **Badges / Alerts**: status carries by border style — solid (success),
  dashed (warning), solid (destructive) — never by hue alone.
- **Overlays** (dialog/sheet/drawer): opaque sheet + rule + hard offset;
  scrim is plain translucent black (`bg-black/20`), never blurred.
- **Tooltips**: solid `inverse` chip, `inverse-foreground` text.
- **The mark**: the wordmark/logo module is a per-consumer brand surface
  (see `platform.ui`'s logo component) — this package only supplies the
  color/type tokens it's drawn with.

## 6. Do / Don't

- DO communicate hierarchy with border width + lightness step before
  reaching for a new token.
- DO use `type-mono-label` (uppercase, tracked mono) for metadata — it
  reads as a dimension annotation.
- DON'T add `box-shadow` with a blur radius, `backdrop-filter`, gradients,
  or translucency on content surfaces. If a diff introduces one, it's wrong.
- DON'T add chromatic accents beyond the fixed contract (primary/
  destructive/success/warning). New states must map onto the border
  grammar instead.
- DON'T reference raw `--color-neutral-*`/`--color-accent-*` steps in
  product UI — semantic tokens only (see README.md).
- DON'T hardcode a hex/HSL literal or a brand string in component source —
  it belongs in `src/tokens/brand.ts`. `bun run brand-lint` enforces this.

## 7. Editing the system

See README.md for the full palette → semantic → component architecture
and the rebrand workflow. Short version: tokens live in `src/tokens/*` (TS
source of truth) → `bun run codegen` regenerates `generated/css/*` →
`bun run audit:contrast` gates. Never hand-edit `generated/css`. After
token changes, run `bun run build` and commit the regenerated CSS.
