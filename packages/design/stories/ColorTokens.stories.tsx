import type { Meta, StoryObj } from "@storybook/react";
import { darkColors, type SemanticTheme } from "../src/tokens/colors";

function Swatch({
  name,
  cssVar,
  description,
  hex,
}: {
  name: string;
  cssVar: string;
  description: string;
  hex: string;
}) {
  return (
    <div className="overflow-hidden rounded-sm border-2 border-border">
      <div className="h-16 border-b border-border" style={{ background: `var(${cssVar})` }} />
      <div className="bg-surface-raised p-3">
        <div className="text-xs font-semibold">{name}</div>
        <div className="type-mono-label text-muted-foreground">{description}</div>
        <div className="type-mono-label text-muted-foreground">{hex}</div>
      </div>
    </div>
  );
}

const NEUTRAL_SWATCHES: Array<{ name: string; key: keyof SemanticTheme; description: string }> = [
  { name: "Background", key: "background", description: "Page canvas" },
  { name: "Card", key: "card", description: "Container surface" },
  { name: "Surface Raised", key: "surfaceRaised", description: "Elevated panel" },
  { name: "Surface Sunken", key: "surfaceSunken", description: "Recessed well" },
  { name: "Border", key: "border", description: "Standard rule" },
  { name: "Border Strong", key: "borderStrong", description: "Heavy rule" },
  { name: "Foreground", key: "foreground", description: "Primary text" },
  { name: "Muted Foreground", key: "mutedForeground", description: "Dimmed text" },
];

const ACCENT_SWATCHES: Array<{ name: string; cssVar: string; key: keyof SemanticTheme }> = [
  { name: "Primary", cssVar: "--color-primary", key: "primary" },
  { name: "Success", cssVar: "--color-success", key: "success" },
  { name: "Warning", cssVar: "--color-warning", key: "warning" },
  { name: "Destructive", cssVar: "--color-destructive", key: "destructive" },
];

/**
 * Specimen page for the semantic token contract (see src/tokens/colors.ts).
 * Swatches shown here are the fixed dark-mode values so the page reads
 * consistently regardless of the surrounding Storybook theme.
 */
function ColorTokensPage() {
  return (
    <div className="max-w-4xl space-y-12 p-8">
      <div>
        <h2 className="mb-2 font-heading text-2xl">Semantic Token Contract</h2>
        <p className="text-sm text-muted-foreground">
          Every token below is defined in src/tokens/colors.ts and generated for both light and dark
          mode. Retint the underlying palette in src/tokens/brand.ts — never these names.
        </p>
      </div>

      {/* Neutrals */}
      <section className="space-y-4">
        <h3 className="type-section-label text-muted-foreground">Neutrals + Text</h3>
        <p className="font-mono text-xs text-muted-foreground">Dark-mode values shown below</p>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-4">
          {NEUTRAL_SWATCHES.map((s) => (
            <Swatch
              key={s.key}
              name={s.name}
              cssVar={`--color-${s.key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`}
              description={s.description}
              hex={darkColors[s.key].hex}
            />
          ))}
        </div>
      </section>

      {/* Functional accents */}
      <section className="space-y-4">
        <h3 className="type-section-label text-muted-foreground">Functional Accents</h3>
        <div className="grid grid-cols-4 gap-3">
          {ACCENT_SWATCHES.map((s) => (
            <div key={s.key} className="overflow-hidden rounded-sm border-2 border-border">
              <div
                className="h-16 border-b border-border"
                style={{ background: `var(${s.cssVar})` }}
              />
              <div className="bg-surface-raised p-3">
                <div className="text-xs font-semibold">{s.name}</div>
                <div className="type-mono-label text-muted-foreground">{s.cssVar}</div>
                <div className="type-mono-label text-muted-foreground">{darkColors[s.key].hex}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Glass Effects */}
      <section className="space-y-4">
        <h3 className="type-section-label text-muted-foreground">Glass Effects</h3>
        <div className="relative h-48 overflow-hidden rounded-sm bg-gradient-to-br from-primary/30 to-destructive/30 p-6">
          <div className="absolute inset-6 rounded-sm glass p-6">
            <p className="font-semibold">Glassmorphism (flat by design)</p>
            <p className="text-sm text-muted-foreground">glass-bg + glass-border + glass-blur</p>
          </div>
        </div>
      </section>
    </div>
  );
}

const meta: Meta = {
  title: "Design/Color Tokens",
  tags: ["autodocs"],
};
export default meta;

export const AllColors: StoryObj = {
  render: () => <ColorTokensPage />,
  parameters: { layout: "fullscreen" },
};
