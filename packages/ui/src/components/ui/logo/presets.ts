import type {
  LogoAngle,
  LogoColorScheme,
  LogoColors,
  LogoDetail,
  LogoGeometry,
  LogoWeight,
  LogoWeights,
} from "./types";

// ── Angle geometries ──

export const GEOMETRIES: Record<LogoAngle, LogoGeometry> = {
  // ~12° half-angle — tight Gemini pillars
  // H crossbar: shaft intersections at x≈95,145 + 2px overshoot
  // V crossbar: rot intersections at y≈94,146 + 2px overshoot
  // Brackets: serif edge → shaft body at y≈45, extended to contact
  tight: {
    shafts: ["M 117,42 L 82,202", "M 123,42 L 158,202"],
    serifs: [
      [100, 38, 120, 38],
      [120, 38, 140, 38],
    ],
    brackets: ["M 101,40 L 117,46", "M 139,40 L 123,46"],
    feet: [
      [74, 204, 90, 204],
      [150, 204, 166, 204],
    ],
    rot: "M 198,82 L 44,120 L 198,158",
    rotInner: "M 190,88 L 54,120 L 190,152",
    hCross: "M 93,142 L 147,142",
    vCross: "M 148,92 L 148,148",
    hairs: ["M 113,42 L 78,202", "M 127,42 L 162,202"],
  },
  // ~18° half-angle — narrow spread
  // H crossbar: shaft intersections at x≈86,154 + 2px overshoot
  // V crossbar: rot intersections at y≈84,157 + 2px overshoot
  narrow: {
    shafts: ["M 117,40 L 68,202", "M 123,40 L 172,202"],
    serifs: [
      [98, 36, 120, 36],
      [120, 36, 142, 36],
    ],
    brackets: ["M 99,38 L 117,45", "M 141,38 L 123,45"],
    feet: [
      [60, 204, 76, 204],
      [164, 204, 180, 204],
    ],
    rot: "M 198,68 L 44,120 L 198,172",
    rotInner: "M 190,76 L 54,120 L 190,164",
    hCross: "M 84,142 L 156,142",
    vCross: "M 152,82 L 152,159",
    hairs: ["M 113,38 L 63,202", "M 127,38 L 177,202"],
  },
  // ~22° half-angle — the canonical form
  // H crossbar: shaft intersections at x≈74,166 + 2px overshoot
  // V crossbar: rot intersections at y≈72,168 + 2px overshoot
  standard: {
    shafts: ["M 116,40 L 50,202", "M 124,40 L 190,202"],
    serifs: [
      [96, 36, 119, 36],
      [121, 36, 144, 36],
    ],
    brackets: ["M 97,38 L 116,45", "M 143,38 L 124,45"],
    feet: [
      [41, 204, 59, 204],
      [181, 204, 199, 204],
    ],
    rot: "M 198,52 L 44,120 L 198,188",
    rotInner: "M 190,62 L 54,120 L 190,178",
    hCross: "M 72,142 L 168,142",
    vCross: "M 152,70 L 152,170",
    hairs: ["M 111,38 L 45,202", "M 129,38 L 195,202"],
  },
  // ~28° half-angle — wide, legs reach edges
  // H crossbar: shaft intersections at x≈65,175 + 2px overshoot
  // V crossbar: rot intersections at y≈62,178 + 2px overshoot
  wide: {
    shafts: ["M 114,40 L 36,202", "M 126,40 L 204,202"],
    serifs: [
      [92, 36, 118, 36],
      [122, 36, 148, 36],
    ],
    brackets: ["M 93,38 L 114,45", "M 147,38 L 126,45"],
    feet: [
      [28, 204, 44, 204],
      [196, 204, 212, 204],
    ],
    rot: "M 198,40 L 48,120 L 198,200",
    rotInner: "M 190,50 L 56,120 L 190,190",
    hCross: "M 63,142 L 177,142",
    vCross: "M 156,60 L 156,180",
    hairs: ["M 109,38 L 31,202", "M 131,38 L 209,202"],
  },
};

// ── Weight presets ──

const WEIGHT_VALUES: Record<LogoWeight, number> = {
  hairline: 4,
  light: 5,
  standard: 7,
  medium: 9,
  heavy: 12,
  ultra: 14,
};

export function resolveWeights(
  weight: LogoWeight | number,
  overrides?: Partial<LogoWeights>,
): LogoWeights {
  const main = typeof weight === "number" ? weight : WEIGHT_VALUES[weight];
  const base: LogoWeights = {
    main,
    serif: Math.max(3, main * 0.55),
    bracket: Math.max(1.5, main * 0.28),
    crossbar: Math.max(2, main * 0.4),
    hairline: Math.max(1, main * 0.22),
  };
  return overrides ? { ...base, ...overrides } : base;
}

// ── Color scheme presets ──

export const COLOR_SCHEMES: Record<LogoColorScheme, LogoColors> = {
  primary: {
    shadowRect: "hsl(210 50% 35%)",
    mainRect: "hsl(210 60% 62%)",
    stroke: "hsl(0 0% 6%)",
  },
  light: {
    shadowRect: "hsl(200 30% 55%)",
    mainRect: "hsl(200 40% 32%)",
    stroke: "hsl(40 15% 93%)",
  },
  "mono-light": {
    shadowRect: "hsl(60 100% 95% / 0.15)",
    mainRect: "hsl(60 100% 95%)",
    stroke: "hsl(0 0% 6%)",
  },
  "mono-dark": {
    shadowRect: "hsl(0 0% 6% / 0.15)",
    mainRect: "hsl(0 0% 6%)",
    stroke: "hsl(60 100% 95%)",
  },
  "on-destructive": {
    shadowRect: "hsl(355 55% 42% / 0.5)",
    mainRect: "hsl(60 100% 95%)",
    stroke: "hsl(355 55% 62%)",
  },
  "on-success": {
    shadowRect: "hsl(165 20% 30%)",
    mainRect: "hsl(165 30% 52%)",
    stroke: "hsl(165 30% 18%)",
  },
};

export function resolveColors(
  colorScheme: LogoColorScheme,
  overrides?: Partial<LogoColors>,
): LogoColors {
  const base = COLOR_SCHEMES[colorScheme];
  return overrides ? { ...base, ...overrides } : base;
}

// ── Detail level visibility ──

const DETAIL_ORDER: LogoDetail[] = ["bare", "serifs", "crossbars", "brackets", "full"];

export interface DetailVisibility {
  serifs: boolean;
  feet: boolean;
  crossbars: boolean;
  brackets: boolean;
  innerHairline: boolean;
  outerHairlines: boolean;
}

export function resolveDetail(detail: LogoDetail): DetailVisibility {
  const level = DETAIL_ORDER.indexOf(detail);
  return {
    serifs: level >= 1,
    feet: level >= 1,
    crossbars: level >= 2,
    brackets: level >= 3,
    innerHairline: level >= 4,
    outerHairlines: level >= 4,
  };
}

// ── Simplified geometries for small sizes ──

export interface SimplifiedGeo {
  shadowRect: { x: number; y: number };
  mainRect: { x: number; y: number };
  shafts: [string, string];
  rot: string;
  strokeWidth: number;
}

export const SIMPLIFIED: Record<"sm" | "xs", SimplifiedGeo> = {
  /** 32px render size */
  sm: {
    shadowRect: { x: 44, y: 44 },
    mainRect: { x: 20, y: 20 },
    shafts: ["M 112,36 L 44,200", "M 128,36 L 196,200"],
    rot: "M 200,44 L 40,120 L 200,196",
    strokeWidth: 18,
  },
  /** 16px render size */
  xs: {
    shadowRect: { x: 48, y: 48 },
    mainRect: { x: 16, y: 16 },
    shafts: ["M 112,36 L 44,200", "M 128,36 L 196,200"],
    rot: "M 200,44 L 40,120 L 200,196",
    strokeWidth: 26,
  },
};
