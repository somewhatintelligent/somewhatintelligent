import type { ComponentProps } from "react";

import { brand, MARK_STROKE, markPaths, type LogoColorScheme } from "./brand.ts";

/**
 * The mark, and the single source of it — used by the app and by satori for OG
 * images alike. That is why it is a hook-free inline SVG: lucide components
 * call `useContext`, which satori cannot run, so one definition that works in
 * both worlds has to be written out rather than composed.
 *
 * Recolors by `colorScheme` with concrete hex for the same reason — CSS custom
 * properties do not resolve in satori. Geometry lives in `./brand`.
 */
export interface LogoIconProps extends Omit<ComponentProps<"svg">, "children"> {
  /** Which surface the mark sits on. @default "primary" */
  colorScheme?: LogoColorScheme;
  /** Rendered width and height in px. @default 80 */
  size?: number;
  /** Overrides the scheme's stroke. */
  stroke?: string;
}

export function LogoIcon({
  ref,
  colorScheme = "primary",
  size = 80,
  stroke,
  className,
  style,
  ...svgProps
}: LogoIconProps) {
  const resolved = stroke ?? MARK_STROKE[colorScheme] ?? "currentColor";
  // Mirrors lucide's `absoluteStrokeWidth` — a constant ~1.75px whatever the
  // size. strokeWidth is in viewBox units, so it scales by 24/size.
  const strokeWidth = (1.75 * 24) / Number(size);

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={resolved}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={brand.ariaLabel}
      className={className}
      style={style}
      {...svgProps}
    >
      <circle cx="12" cy="12" r={markPaths.circleRadius} />
      {markPaths.ticks.map((d) => (
        <path key={d} d={d} />
      ))}
      <circle cx="12" cy="12" r={markPaths.centerRadius} fill={resolved} stroke="none" />
    </svg>
  );
}
