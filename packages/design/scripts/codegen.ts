/**
 * Design Token Codegen
 *
 * Reads the TS source-of-truth tokens and generates platform-specific outputs.
 * Currently generates:
 *   - generated/css/tokens.css        (CSS custom properties)
 *   - generated/css/tailwind-theme.css (Tailwind @theme registrations)
 *   - generated/css/utilities.css     (@utility type-* blocks from typography tokens)
 *   - generated/css/reset.css         (minimal opinionated reset)
 *
 * Run: bun run codegen
 */

import { mkdir } from "node:fs/promises";
import {
  lightColors,
  darkColors,
  effectColors,
  rawPaletteEntries,
  type HSLColor,
  type SemanticTheme,
} from "../src/tokens/colors";
import {
  fluidType,
  fixedType,
  uiType,
  fontStacks,
  customLeading,
  customTracking,
} from "../src/tokens/typography";
import { semanticSpacing, layout } from "../src/tokens/spacing";
import { breakpoints } from "../src/tokens/breakpoints";
import { radius } from "../src/tokens/radius";
import {
  brutalShadows,
  softShadows,
  neoShadows,
  glassShadow,
  shadowFamilies,
  softShadowColors,
} from "../src/tokens/shadows";

const GENERATED_DIR = new URL("../generated", import.meta.url).pathname;

await mkdir(`${GENERATED_DIR}/css`, { recursive: true });

// ============================================
// CSS Custom Properties
// ============================================

function cssVar(name: string, color: HSLColor): string {
  return `  --${name}: hsl(${color.hsl});\n  --${name}-hsl: ${color.hsl};`;
}

function fontVarName(font: keyof typeof fontStacks): string {
  return `var(--font-${fontStacks[font].cssName})`;
}

function clamp(min: number, preferred: string, max: number): string {
  return `clamp(${min}px, ${preferred}, ${max}px)`;
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** The fixed semantic contract, in declaration order — every component in
 *  @si/ui is written against exactly these var names. */
const SEMANTIC_KEYS = Object.keys(lightColors) as (keyof SemanticTheme)[];

// ============================================
// Shadow CSS helpers — derive all names from token keys
// ============================================

/** Generate neo shadow CSS value for a given theme's variant */
function neoShadowValue(
  variant: {
    dark: { x: number; y: number; blur: number; opacity: number };
    light: { x: number; y: number; blur: number; opacity: number };
  },
  colors: { darkHsl: string; lightHsl: string },
  inset = false,
): string {
  const prefix = inset ? "inset " : "";
  const d = variant.dark;
  const l = variant.light;
  return `${prefix}${d.x}px ${d.y}px ${d.blur}px hsl(${colors.darkHsl} / ${d.opacity}), ${prefix}${l.x}px ${l.y}px ${l.blur}px hsl(${colors.lightHsl} / ${l.opacity})`;
}

/** Generate soft shadow CSS value from layers + base HSL */
function softShadowValue(
  entry: { layers: readonly { y: number; blur: number; opacity: number }[] },
  baseHsl: string,
): string {
  return entry.layers
    .map((l) => `0 ${l.y}px ${l.blur}px hsl(${baseHsl} / ${l.opacity})`)
    .join(", ");
}

/** Write shadow variables for a given mode (light/dark) */
function writeShadowVars(lines: string[], indent: string, mode: "light" | "dark", textHsl: string) {
  const nf = shadowFamilies.neo;
  const bf = shadowFamilies.brutal;
  const sf = shadowFamilies.soft;
  const gf = shadowFamilies.glass;
  const nc = neoShadows.colors[mode];
  const neoMode = neoShadows[mode];

  // Neo variants — iterate keys (raised, inset) from the token structure
  for (const [variant, value] of Object.entries(neoMode)) {
    const isInset = variant === "inset";
    lines.push(`${indent}--${nf}-${variant}: ${neoShadowValue(value, nc, isInset)};`);
  }

  // Brutal — iterate keys (sm, md, lg) from token structure
  for (const [k, v] of Object.entries(brutalShadows)) {
    lines.push(`${indent}--${bf}-${k}: ${v.x}px ${v.y}px 0 var(--color-border-strong);`);
  }

  // Soft — iterate keys (sm, md, lg) from token structure
  const softBase = mode === "dark" ? softShadowColors.darkHsl : textHsl;
  for (const [k, v] of Object.entries(softShadows)) {
    lines.push(`${indent}--${sf}-${k}: ${softShadowValue(v, softBase)};`);
  }

  // Glass shadow
  lines.push(
    `${indent}--${gf}-shadow: 0 4px ${glassShadow.blur}px hsl(0 0% 0% / ${glassShadow.opacity});`,
  );
}

/** Write effect (glass) variables — names derived from effectColors keys */
function writeEffectVars(lines: string[], indent: string, mode: "light" | "dark") {
  const modeColors = effectColors[shadowFamilies.glass][mode];
  for (const [key, value] of Object.entries(modeColors)) {
    lines.push(`${indent}--${shadowFamilies.glass}-${key}: ${value};`);
  }
  if (mode === "light") {
    lines.push(
      `${indent}--${shadowFamilies.glass}-blur: ${effectColors[shadowFamilies.glass].blur};`,
    );
  }
}

/** Write every semantic contract var for one theme (light or dark). */
function writeSemanticVars(lines: string[], indent: string, theme: SemanticTheme) {
  for (const key of SEMANTIC_KEYS) {
    const name = `color-${camelToKebab(key)}`;
    const color = theme[key];
    lines.push(`${indent}--${name}: hsl(${color.hsl});`);
    lines.push(`${indent}--${name}-hsl: ${color.hsl};`);
  }
}

function generateTokensCSS(): string {
  const lines: string[] = [];

  lines.push("/* ═══════════════════════════════════════════════════");
  lines.push("   GENERATED — do not edit. Source: src/tokens/");
  lines.push("   Run: bun run codegen");
  lines.push("   ═══════════════════════════════════════════════════ */");
  lines.push("");

  // Light mode (default)
  lines.push(":root {");
  lines.push("  /* Semantic contract — see src/tokens/colors.ts */");
  writeSemanticVars(lines, "  ", lightColors);
  lines.push("");
  lines.push("  /* Effects */");
  writeEffectVars(lines, "  ", "light");
  lines.push("");
  lines.push("  /* Shadows */");
  writeShadowVars(lines, "  ", "light", lightColors.foreground.hsl);
  lines.push("");
  lines.push("  /* Fonts — swap the family values in src/tokens/typography.ts */");
  for (const stack of Object.values(fontStacks)) {
    lines.push(`  --font-${stack.cssName}: ${stack.family};`);
  }
  lines.push("");
  lines.push("  /* Raw brand palette (exact hex, theme-invariant) — src/tokens/brand.ts */");
  for (const [name, hex] of rawPaletteEntries()) {
    lines.push(`  --color-${name}: ${hex};`);
  }
  lines.push("");
  lines.push("  /* Radius (theme-invariant; aliased by @theme so tenants can override) */");
  for (const [k, v] of Object.entries(radius)) {
    lines.push(`  --radius-${k}: ${v === 9999 ? "9999px" : `${v}px`};`);
  }
  lines.push("");
  lines.push(
    "  /* Semantic spacing (theme-invariant; aliased by @theme so tenants can override) */",
  );
  for (const [k, v] of Object.entries(semanticSpacing)) {
    lines.push(`  --spacing-${k}: ${clamp(v.min, v.preferred, v.max)};`);
  }
  lines.push("}");
  lines.push("");

  // Shared dark-mode vars — used in both [data-theme] and @media blocks
  function writeDarkVars(lines: string[], indent: string) {
    lines.push(`${indent}/* Semantic contract — see src/tokens/colors.ts */`);
    writeSemanticVars(lines, indent, darkColors);
    lines.push("");
    lines.push(`${indent}/* Effects */`);
    writeEffectVars(lines, indent, "dark");
    lines.push("");
    lines.push(`${indent}/* Shadows (dark) */`);
    writeShadowVars(lines, indent, "dark", darkColors.foreground.hsl);
  }

  // Dark mode
  lines.push('[data-theme="dark"] {');
  writeDarkVars(lines, "  ");
  lines.push("}");
  lines.push("");

  // System preference fallback
  lines.push("@media (prefers-color-scheme: dark) {");
  lines.push('  :root:not([data-theme="light"]) {');
  writeDarkVars(lines, "    ");
  lines.push("  }");
  lines.push("}");

  return `${lines.join("\n")}\n`;
}

// ============================================
// Reset CSS
// ============================================

function generateResetCSS(): string {
  return `/* ═══════════════════════════════════════════════════
   GENERATED — do not edit. Source: src/tokens/
   Run: bun run codegen
   ═══════════════════════════════════════════════════ */

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

body {
  background: var(--color-background);
  color: var(--color-foreground);
  line-height: 1.5;
  min-height: 100vh;
}

img, picture, video, canvas, svg {
  display: block;
  max-width: 100%;
}

input, button, textarea, select {
  font: inherit;
  color: inherit;
}

a {
  color: inherit;
  text-decoration: none;
}
`;
}

// ============================================
// Tailwind v4 Theme
// ============================================

function generateTailwindTheme(): string {
  const colorLines = [
    "  /* Semantic contract — every name here is legal in @si/ui",
    "     component source (see README.md `--strict-semantic`). */",
    ...SEMANTIC_KEYS.map((k) => {
      const name = `color-${camelToKebab(k)}`;
      return `  --${name}: var(--${name});`;
    }),
    "",
    "  /* Glass */",
    ...["bg", "border"].map(
      (k) => `  --color-${shadowFamilies.glass}-${k}: var(--${shadowFamilies.glass}-${k});`,
    ),
    "",
    "  /* Raw brand ramps — exact-hex utilities (bg-neutral-900, text-accent-500, …) */",
    ...rawPaletteEntries().map(([name]) => `  --color-${name}: var(--color-${name});`),
  ];

  const fontLines = [
    "  /* Fonts */",
    ...Object.values(fontStacks).map((s) => `  --font-${s.cssName}: var(--font-${s.cssName});`),
  ];

  const { brutal: bf, soft: sf, neo: nf } = shadowFamilies;
  const shadowLines = [
    "  /* Shadows — override Tailwind defaults to our soft shadows */",
    ...Object.keys(softShadows).map((k) => `  --shadow-${k}: var(--${sf}-${k});`),
    "",
    "  /* Shadows — Platform tokens */",
    ...Object.keys(brutalShadows).map((k) => `  --shadow-${bf}-${k}: var(--${bf}-${k});`),
    ...Object.keys(softShadows).map((k) => `  --shadow-${sf}-${k}: var(--${sf}-${k});`),
    ...Object.keys(neoShadows.light).map((k) => `  --shadow-${nf}-${k}: var(--${nf}-${k});`),
  ];

  // Override Tailwind's default --text-* with our line-heights
  const uiTypeLines = [
    "  /* UI Type Scale — override Tailwind defaults with our line-heights */",
    ...Object.entries(uiType).map(
      ([k, v]) => `  --text-${k}: ${v.size / 16}rem;\n  --text-${k}--line-height: ${v.leading};`,
    ),
  ];

  return [
    "/* ═══════════════════════════════════════════════════",
    "   GENERATED — do not edit. Source: src/tokens/",
    "   Run: bun run codegen",
    "",
    "   Import AFTER tokens.css:",
    '   @import "tailwindcss";',
    '   @import "@si/design/generated/css/tokens.css";',
    '   @import "@si/design/generated/css/tailwind-theme.css";',
    "   ═══════════════════════════════════════════════════ */",
    "",
    "@theme inline {",
    ...colorLines,
    "",
    ...fontLines,
    "",
    ...shadowLines,
    "",
    ...uiTypeLines,
    "",
    "  /* Typography Scale — fluid (clamp) */",
    ...Object.entries(fluidType).flatMap(([key, t]) => {
      const k = camelToKebab(key);
      return [
        `  --text-${k}: ${clamp(t.min, t.preferred, t.max)};`,
        `  --text-${k}--line-height: ${t.leading};`,
      ];
    }),
    "",
    "  /* Typography Scale — fixed */",
    ...Object.entries(fixedType).flatMap(([key, t]) => {
      const k = camelToKebab(key);
      return [`  --text-${k}: ${t.size}px;`, `  --text-${k}--line-height: ${t.leading};`];
    }),
    "",
    "  /* Custom Leading */",
    ...Object.entries(customLeading).map(([k, v]) => `  --leading-${k}: ${v};`),
    "",
    "  /* Custom Tracking */",
    ...Object.entries(customTracking).map(([k, v]) => `  --tracking-${k}: ${v};`),
    "",
    "  /* Semantic Spacing — aliased to tokens.css vars so tenants can override */",
    ...Object.keys(semanticSpacing).map((k) => `  --spacing-${k}: var(--spacing-${k});`),
    "",
    "  /* Breakpoints */",
    ...Object.entries(breakpoints).map(([k, v]) => `  --breakpoint-${k}: ${v}px;`),
    "",
    "  /* Containers / Layout Widths */",
    `  --container-prose: ${clamp(layout.prose.min, layout.prose.preferred, layout.prose.max)};`,
    `  --container-content: ${layout.content}px;`,
    "",
    "  /* Radius — aliased to tokens.css vars so tenants can override */",
    ...Object.keys(radius).map((k) => `  --radius-${k}: var(--radius-${k});`),
    "",
    "  /* Blur */",
    `  --blur-${shadowFamilies.glass}: var(--${shadowFamilies.glass}-blur);`,
    "}",
    "",
  ].join("\n");
}

// ============================================
// Typography Utilities (utilities.css)
// ============================================

function generateUtilitiesCSS(): string {
  const lines: string[] = [];

  lines.push("/* ═══════════════════════════════════════════════════");
  lines.push("   GENERATED — do not edit. Source: src/tokens/typography.ts");
  lines.push("   Run: bun run codegen");
  lines.push("   ═══════════════════════════════════════════════════ */");
  lines.push("");

  // Fluid type utilities
  for (const [key, t] of Object.entries(fluidType)) {
    const name = `type-${camelToKebab(key)}`;
    lines.push(`@utility ${name} {`);
    lines.push(`  font-family: ${fontVarName(t.font)};`);
    lines.push(`  font-size: ${clamp(t.min, t.preferred, t.max)};`);
    lines.push(`  font-weight: ${t.weight};`);
    lines.push(`  line-height: ${t.leading};`);
    if (t.tracking !== 0) lines.push(`  letter-spacing: ${t.tracking}em;`);
    if ("style" in t) lines.push(`  font-style: ${t.style};`);
    lines.push("}");
    lines.push("");
  }

  // Fixed type utilities
  for (const [key, t] of Object.entries(fixedType)) {
    const name = `type-${camelToKebab(key)}`;
    lines.push(`@utility ${name} {`);
    if ("font" in t) lines.push(`  font-family: ${fontVarName(t.font)};`);
    lines.push(`  font-size: ${t.size}px;`);
    lines.push(`  font-weight: ${t.weight};`);
    lines.push(`  line-height: ${t.leading};`);
    if (t.tracking !== 0) lines.push(`  letter-spacing: ${t.tracking}em;`);
    if ("transform" in t) lines.push(`  text-transform: ${t.transform};`);
    lines.push("}");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

// ============================================
// Write outputs
// ============================================

const outputs = [
  { path: "css/tokens.css", content: generateTokensCSS() },
  { path: "css/reset.css", content: generateResetCSS() },
  { path: "css/tailwind-theme.css", content: generateTailwindTheme() },
  { path: "css/utilities.css", content: generateUtilitiesCSS() },
];

for (const { path, content } of outputs) {
  const fullPath = `${GENERATED_DIR}/${path}`;
  await Bun.write(fullPath, content);
  console.log(`  ✓ generated/${path}`);
}

console.log(`\n  ${outputs.length} files generated.`);
