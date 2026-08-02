# @si/design

The brand-neutral token engine for this template. Every color, radius,
shadow, spacing, and font value a consumer app or `@si/ui` component
touches is generated from the TypeScript source in `src/tokens/*` — there
is no hand-written CSS color literal anywhere downstream of this package.

## Token architecture: palette → semantic → components

```
src/tokens/brand.ts          PALETTE  — the only file with color literals
        │                    (grayscale ramp, one accent hue, the
        │                     destructive/success/warning triad)
        ▼
src/tokens/colors.ts         SEMANTIC — maps the palette onto the fixed
        │                    contract: background, foreground, card,
        │                    popover, primary(+hover), secondary, muted,
        │                    accent, destructive(+hover), success,
        │                    warning, border(+strong), input, ring,
        │                    surface-sunken/-raised, inverse, chart-1..5,
        │                    sidebar set — in both light and dark.
        ▼
scripts/codegen.ts           Generates generated/css/{tokens,tailwind-theme,
        │                    utilities}.css from the TS source above.
        ▼
src/theme.css                Single import for consumer apps: Tailwind v4 +
        │                    generated tokens + fonts + shadcn compat.
        ▼
@si/ui components      Consume ONLY the semantic contract names
                              (bg-primary, text-destructive-foreground, …)
                              — never a raw palette step, never a literal.
```

Two other token families live alongside colors and follow the same rule
(all literals in one file, everything else derived):

- **Fonts** — `src/tokens/typography.ts` (`fontStacks`) + `src/fonts.css`
  (`@font-face`). Barlow Condensed carries display claims, Source Serif 4
  carries interface and editorial copy, and Iosevka carries evidence/state.
- **Shadows / radius** — `src/tokens/shadows.ts`, `src/tokens/radius.ts`.
  These encode a structural material language (hard-edged, zero-blur
  shadows; nearly square corners) that is independent of brand color.

## Rebranding this template

1. Edit `src/tokens/brand.ts` — retint `neutralRamp` / `accentRamp` and
   the light/dark HSL values in `lightPalette` / `darkPalette` /
   `functionalColors`.
2. Regenerate and verify:
   ```sh
   bun run codegen         # writes generated/css/*
   bun run audit:contrast  # WCAG AA gate — tune brand.ts until it's green
   bun run brand-lint src  # confirms no literal leaked outside brand.ts
   ```
3. To swap fonts: replace the vendored files under `src/fonts/`, update
   the `@font-face` blocks in `src/fonts.css`, and repoint the `family`
   strings in `src/tokens/typography.ts` (`fontStacks`).
4. Shape and elevation changes belong in `src/tokens/radius.ts` and
   `src/tokens/shadows.ts`; keep their stable token names intact.

Component source never changes. If a component needs a color that isn't
in the semantic contract, that's a contract change (add the field to
`SemanticTheme` in `src/tokens/colors.ts`, both themes, then teach
`scripts/codegen.ts` and `scripts/audit-contrast.ts` about it) — not a
reason to reach for a raw palette step or a new literal.

## `@si/ui` must stay strict-semantic

Every component in `@si/ui` is written against exactly the semantic
contract above — no raw palette steps (`bg-neutral-500`), no hex/HSL
literals, no brand strings. This is enforced by:

```sh
bun run brand-lint <dir> [<dir> ...] [options]
```

```
Options:
  --allow <glob>        Add an allowlist glob for hex literals (repeatable).
                         Defaults: the design brand surface, the ui logo
                         module, og assets.
  --brand-word <word>   Flag this string anywhere in scanned files (repeatable).
  --strict-semantic      Only semantic contract tokens are legal in Tailwind
                         color utilities — use this for ui component dirs.
  --ext <.tsx,.ts,...>   Comma-separated extensions to scan (default: .ts,.tsx,.css).
  --help                 Print usage and exit 0.
```

Example — gate a UI component library in CI or a pre-commit hook:

```sh
bun run brand-lint ../ui/src/components --strict-semantic --brand-word "AcmeCorp"
```

Exit code is `1` on any violation (hex literal outside the brand surface,
a non-semantic/undeclared color utility, or a matched `--brand-word`), `0`
otherwise. See `scripts/brand-lint.test.ts` for fixture examples of what
it does and doesn't flag.

## Commands

```sh
bun run codegen         # regenerate generated/css/* from src/tokens/*
bun run audit:contrast  # WCAG AA/AAA report over the semantic contract
bun run brand-lint      # scan a tree for brand/hex literals (see above)
bun run build           # codegen + audit:contrast
bun run test            # brand-lint's own fixture tests (bun test)
bun run typecheck       # tsc --noEmit
```

## TODOs / known gaps

- `scripts/brand-lint.ts`'s Tailwind-utility check is regex-based, not a
  full Tailwind grammar — prefixes like `text-`/`border-`/`ring-` are
  overloaded with non-color utilities (sizes, geometry). A best-effort
  exclusion list (`NON_COLOR_KEYWORDS`) covers the common cases; add to
  it (or to `--allow`) if a project hits false positives.
- Several `stories/*.tsx` specimens still carry cosmetic labels (e.g. font
  names in Typography stories) that don't reflect `fontStacks` — harmless
  for Storybook rendering, worth tidying if this package's stories are
  wired into an actual Storybook build.
