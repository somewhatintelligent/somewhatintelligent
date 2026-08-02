/**
 * WCAG Contrast Ratio Audit
 *
 * Checks every semantic contract pair (see src/tokens/colors.ts) against
 * WCAG guidelines:
 * - AA Normal text: 4.5:1
 * - AA Large text / non-text UI (border, ring, …): 3:1
 * - AAA Normal text: 7:1
 * - AAA Large text: 4.5:1
 *
 * Run: bun run audit:contrast
 */

import { lightColors, darkColors, type HSLColor, type SemanticTheme } from "../src/tokens/colors";

// --- WCAG relative luminance + contrast ratio ---

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relativeLuminance(color: HSLColor): number {
  const [r, g, b] = hexToRgb(color.hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrastRatio(fg: HSLColor, bg: HSLColor): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function grade(ratio: number): string {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-lg";
  return "FAIL";
}

// --- Define pairs, driven by the semantic contract itself ---

interface CheckPair {
  label: string;
  fg: HSLColor;
  bg: HSLColor;
  context: "normal" | "large";
}

/** Text-on-fill pairs: [foreground key, background key][] */
const TEXT_PAIRS: [keyof SemanticTheme, keyof SemanticTheme][] = [
  ["foreground", "background"],
  ["mutedForeground", "background"],
  ["cardForeground", "card"],
  ["popoverForeground", "popover"],
  ["secondaryForeground", "secondary"],
  ["mutedForeground", "muted"],
  ["accentForeground", "accent"],
  ["primaryForeground", "primary"],
  ["destructiveForeground", "destructive"],
  ["successForeground", "success"],
  ["warningForeground", "warning"],
  ["inverseForeground", "inverse"],
  ["sidebarForeground", "sidebar"],
  ["sidebarAccentForeground", "sidebarAccent"],
  ["sidebarPrimaryForeground", "sidebarPrimary"],
];

/** Non-text UI pairs (borders, rings, chart marks) — WCAG 1.4.11, 3:1 floor */
const UI_PAIRS: [keyof SemanticTheme, keyof SemanticTheme][] = [
  ["border", "background"],
  ["borderStrong", "background"],
  ["input", "background"],
  ["ring", "background"],
  ["sidebarBorder", "sidebar"],
  ["chart1", "background"],
  ["chart2", "background"],
  ["chart3", "background"],
  ["chart4", "background"],
  ["chart5", "background"],
];

function buildPairs(): CheckPair[] {
  const pairs: CheckPair[] = [];

  function addMode(modeName: string, theme: SemanticTheme) {
    for (const [fgKey, bgKey] of TEXT_PAIRS) {
      pairs.push({
        label: `[${modeName}] ${fgKey} on ${bgKey}`,
        fg: theme[fgKey],
        bg: theme[bgKey],
        context: "normal",
      });
    }
    for (const [fgKey, bgKey] of UI_PAIRS) {
      pairs.push({
        label: `[${modeName}] ${fgKey} on ${bgKey}`,
        fg: theme[fgKey],
        bg: theme[bgKey],
        context: "large",
      });
    }
  }

  addMode("Light", lightColors);
  addMode("Dark", darkColors);

  return pairs;
}

// --- Run ---

const pairs = buildPairs();
let failCount = 0;
let warnCount = 0;
let passCount = 0;

const results: Array<{
  label: string;
  ratio: string;
  fg: string;
  bg: string;
  grade: string;
  required: string;
  status: "PASS" | "WARN" | "FAIL";
}> = [];

for (const pair of pairs) {
  const ratio = contrastRatio(pair.fg, pair.bg);
  const g = grade(ratio);
  const required = pair.context === "normal" ? 4.5 : 3;
  const requiredLabel = pair.context === "normal" ? "4.5:1 (AA)" : "3:1 (AA-lg)";

  let status: "PASS" | "WARN" | "FAIL";
  if (ratio >= (pair.context === "normal" ? 7 : 4.5)) {
    status = "PASS";
    passCount++;
  } else if (ratio >= required) {
    status = "WARN";
    warnCount++;
  } else {
    status = "FAIL";
    failCount++;
  }

  results.push({
    label: pair.label,
    ratio: ratio.toFixed(2),
    fg: `hsl(${pair.fg.hsl})`,
    bg: `hsl(${pair.bg.hsl})`,
    grade: g,
    required: requiredLabel,
    status,
  });
}

// --- Output ---

console.log("");
console.log("╔══════════════════════════════════════════════════╗");
console.log("║   DESIGN TOKEN ENGINE — SEMANTIC CONTRAST AUDIT   ║");
console.log("╚══════════════════════════════════════════════════╝");
console.log("");

const failures = results.filter((r) => r.status === "FAIL");
if (failures.length > 0) {
  console.log("❌ FAILURES (below WCAG AA minimum):\n");
  for (const r of failures) {
    console.log(`  ${r.ratio.padStart(5)}:1  ${r.grade.padEnd(6)}  ${r.label}`);
    console.log(`                     need ${r.required}  |  fg: ${r.fg}  bg: ${r.bg}\n`);
  }
}

const warnings = results.filter((r) => r.status === "WARN");
if (warnings.length > 0) {
  console.log("⚠️  WARNINGS (AA but not AAA):\n");
  for (const r of warnings) {
    console.log(`  ${r.ratio.padStart(5)}:1  ${r.grade.padEnd(6)}  ${r.label}`);
  }
  console.log("");
}

console.log("─".repeat(52));
console.log(
  `  ✅ AAA: ${passCount}   ⚠️ AA-only: ${warnCount}   ❌ Fail: ${failCount}   Total: ${results.length}`,
);
console.log("─".repeat(52));

if (failCount > 0) {
  console.log("\n  Fix: adjust H/S/L in src/tokens/brand.ts, re-run.\n");
  process.exit(1);
} else if (warnCount > 0) {
  console.log("\n  ✅ All pairs meet WCAG AA. Some don't reach AAA.\n");
} else {
  console.log("\n  ✅ All pairs meet WCAG AAA.\n");
}
