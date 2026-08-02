import type { ComponentProps } from "react";

// ── Preset enums ──

export type LogoAngle = "tight" | "narrow" | "standard" | "wide";
export type LogoWeight = "hairline" | "light" | "standard" | "medium" | "heavy" | "ultra";
export type LogoDetail = "bare" | "serifs" | "crossbars" | "brackets" | "full";
export type LogoColorScheme =
  | "primary"
  | "light"
  | "mono-light"
  | "mono-dark"
  | "on-destructive"
  | "on-success";
export type LogoLayout = "icon" | "horizontal" | "stacked" | "compact";

// ── Geometry data shape ──

export interface LogoGeometry {
  shafts: [string, string];
  serifs: [[number, number, number, number], [number, number, number, number]];
  brackets: [string, string];
  feet: [[number, number, number, number], [number, number, number, number]];
  rot: string;
  rotInner: string;
  hCross: string;
  vCross: string;
  hairs: [string, string];
}

// ── Color scheme data shape ──

export interface LogoColors {
  shadowRect: string;
  mainRect: string;
  stroke: string;
}

// ── Weight resolved values ──

export interface LogoWeights {
  main: number;
  serif: number;
  bracket: number;
  crossbar: number;
  hairline: number;
}

// ── Element-level override props ──

type SvgRectOverride = Partial<ComponentProps<"rect">> | false;
type SvgPathOverride = Partial<ComponentProps<"path">> | false;
type SvgLineOverride = Partial<ComponentProps<"line">> | false;

export interface LogoElementOverrides {
  /** Shadow rectangle behind the main rect. Pass `false` to hide. */
  shadowRect?: SvgRectOverride;
  /** Main colored rectangle. Pass `false` to hide. */
  mainRect?: SvgRectOverride;
  /** Left pillar shaft. Pass `false` to hide. */
  leftShaft?: SvgPathOverride;
  /** Right pillar shaft. Pass `false` to hide. */
  rightShaft?: SvgPathOverride;
  /** Left serif cap. Pass `false` to hide. */
  leftSerifCap?: SvgLineOverride;
  /** Right serif cap. Pass `false` to hide. */
  rightSerifCap?: SvgLineOverride;
  /** Left bracket connector. Pass `false` to hide. */
  leftBracket?: SvgPathOverride;
  /** Right bracket connector. Pass `false` to hide. */
  rightBracket?: SvgPathOverride;
  /** Left foot serif. Pass `false` to hide. */
  leftFootSerif?: SvgLineOverride;
  /** Right foot serif. Pass `false` to hide. */
  rightFootSerif?: SvgLineOverride;
  /** Rotated A (the V chevron). Pass `false` to hide. */
  rotatedA?: SvgPathOverride;
  /** Inner hairline V parallel to the rotated A. Pass `false` to hide. */
  innerHairline?: SvgPathOverride;
  /** Horizontal crossbar. Pass `false` to hide. */
  hCrossbar?: SvgPathOverride;
  /** Vertical crossbar. Pass `false` to hide. */
  vCrossbar?: SvgPathOverride;
  /** Left outer hairline parallel to left shaft. Pass `false` to hide. */
  leftOuterHairline?: SvgPathOverride;
  /** Right outer hairline parallel to right shaft. Pass `false` to hide. */
  rightOuterHairline?: SvgPathOverride;
}

// ── LogoIcon props ──

export interface LogoIconProps
  extends Omit<ComponentProps<"svg">, "children">, LogoElementOverrides {
  /** Pillar spread angle. @default "standard" */
  angle?: LogoAngle;
  /** Stroke weight preset or a custom main stroke width in px. @default "standard" */
  weight?: LogoWeight | number;
  /** How many detail elements to render. @default "full" */
  detail?: LogoDetail;
  /** Color scheme preset. @default "primary" */
  colorScheme?: LogoColorScheme;
  /** Rendered width & height in px. @default 80 */
  size?: number;
  /** Custom colors — overrides colorScheme when provided. */
  colors?: Partial<LogoColors>;
  /** Custom stroke weights — overrides weight when provided. */
  weights?: Partial<LogoWeights>;
}

// ── Top-level Logo props ──

export interface LogoProps extends Omit<LogoIconProps, "className" | "style"> {
  /** Layout mode. @default "icon" */
  layout?: LogoLayout;
  /** Container className */
  className?: string;
  /** Container style */
  style?: React.CSSProperties;
  /** Props forwarded to the icon SVG. */
  iconProps?: Partial<LogoIconProps>;
}
