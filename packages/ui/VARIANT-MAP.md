# Variant rename map

Brand-flavored/nonsense variant names renamed to the semantic vocabulary
(`default` / `primary` / `secondary` / `outline` / `ghost` / `link` /
`destructive` / `success` / `warning` / `inverse`, plus material-suffixed
compounds `-brutal` / `-glass`). App call sites need updating to match —
this file is the checklist for that pass.

## `Button` (`src/components/ui/button.tsx`)

| Old variant   | New variant   | Notes                                                                                                                        |
| ------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `default`     | `default`     | unchanged — now reads `bg-primary`/`hover:bg-primary-hover` (was `bg-ink`/`bg-ink-hover`)                                    |
| `strong`      | `strong`      | unchanged (emphasis variant, not a color name)                                                                               |
| `outline`     | `outline`     | unchanged                                                                                                                    |
| `ghost`       | `ghost`       | unchanged                                                                                                                    |
| `dark`        | `inverse`     | fixed always-dark control; now `bg-inverse`/`text-inverse-foreground`                                                        |
| `destructive` | `destructive` | unchanged name; fill retargeted `bg-rust` → `bg-destructive`, text `text-primary-foreground` → `text-destructive-foreground` |
| `link`        | `link`        | unchanged                                                                                                                    |
| `secondary`   | `secondary`   | unchanged                                                                                                                    |
| `neo`         | `neo`         | unchanged                                                                                                                    |
| `glass`       | `glass`       | unchanged                                                                                                                    |
| `success`     | `success`     | unchanged name; text fixed `text-primary-foreground` → `text-success-foreground`                                             |

## `Badge` (`src/components/ui/badge.tsx`)

| Old variant      | New variant          | Notes                                                                                |
| ---------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `default`        | `default`            | unchanged (already `bg-primary`)                                                     |
| `secondary`      | `secondary`          | unchanged                                                                            |
| `destructive`    | `destructive`        | unchanged name; text fixed → `text-destructive-foreground`                           |
| `outline`        | `outline`            | unchanged                                                                            |
| `ink`            | `default`            | duplicate of `default` (both were `bg-primary` fills) — drop `ink`, use `default`    |
| `rust`           | `destructive`        | duplicate of `destructive` — drop `rust`, use `destructive`                          |
| `success`        | `success`            | promoted from the accent-only spread into a first-class variant                      |
| `warning`        | `warning`            | promoted from the accent-only spread into a first-class variant                      |
| `soft`           | `success`            | was a success-tinted "status stamp" — collapse into `success`                        |
| `contrast`       | `inverse`            | new first-class `inverse` variant (`bg-inverse`/`text-inverse-foreground`)           |
| `warn`           | `warning`            | dashed-tint duplicate of the new `warning` — collapse into `warning`                 |
| `danger`         | `destructive`        | solid-rust duplicate of `destructive` — collapse into `destructive`                  |
| `info`           | `secondary`          | no semantic `info` token exists in the new contract — nearest neutral is `secondary` |
| `ink-brutal`     | `default-brutal`     |                                                                                      |
| `rust-brutal`    | `destructive-brutal` |                                                                                      |
| `success-brutal` | `success-brutal`     | unchanged                                                                            |
| `warning-brutal` | `warning-brutal`     | unchanged                                                                            |
| `info-brutal`    | _(removed)_          | no `info` token — use `secondary` (plain) or drop the brutal treatment               |
| `ink-glass`      | `default-glass`      |                                                                                      |
| `rust-glass`     | `destructive-glass`  |                                                                                      |
| `success-glass`  | `success-glass`      | unchanged                                                                            |
| `warning-glass`  | `warning-glass`      | unchanged                                                                            |
| `info-glass`     | _(removed)_          | no `info` token — use `secondary` (plain) or drop the glass treatment                |

## `Alert` (`src/components/ui/alert.tsx`)

| Old variant   | New variant   | Notes                                                                                                                     |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `default`     | `default`     | unchanged                                                                                                                 |
| `destructive` | `destructive` | unchanged name; retargeted `border-rust`/`bg-rust`/`text-rust` → `border-destructive`/`bg-destructive`/`text-destructive` |
| `ink`         | `primary`     | the accented informational style; retargeted to `border-primary`/`bg-primary`/`text-primary`                              |
| `success`     | `success`     | unchanged                                                                                                                 |
| `warning`     | `warning`     | unchanged                                                                                                                 |
| `info`        | `primary`     | no semantic `info` token — collapses into the same `primary` informational style as former `ink`                          |

## `Card` (`src/components/ui/card.tsx`)

| Old variant | New variant | Notes                                                                        |
| ----------- | ----------- | ---------------------------------------------------------------------------- |
| `dark`      | `inverse`   | fixed dark tile; now `bg-inverse`/`text-inverse-foreground`/`border-inverse` |

## Logo `LogoColorScheme` (`src/components/ui/logo/types.ts`)

Not a cva variant, but the same brand-word cleanup applies to this public
enum (used by `Logo`, `LogoIcon`, `LogoAnimated`, `LogoLoading`):

| Old value    | New value        |
| ------------ | ---------------- |
| `mono-paper` | `mono-light`     |
| `mono-void`  | `mono-dark`      |
| `on-rust`    | `on-destructive` |

## Not renamed (already semantic, listed for completeness)

`Tabs` active-tab underline moved `border-ink` → `border-primary` (no
variant name involved, just a token swap). `Sonner`'s error icon/CSS vars
moved `text-rust` / `var(--color-rust)` → `text-destructive` /
`var(--color-destructive)` (no variant name involved).
