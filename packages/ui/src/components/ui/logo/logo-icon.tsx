import { MARK_STROKE, markPaths, brand } from "./brand";
import type { LogoIconProps } from "./types";

/**
 * The mark geometry lives in `./brand` (`markPaths`). In this fork it is the
 * FRIEND declaration's asterisk: footnote, wildcard, and provenance mark.
 *
 * This is the SINGLE source of the mark, used by the app AND by satori/OG
 * image generation, so it must stay a hook-free SVG (no lucide components —
 * they call useContext, which satori cannot run). Inlining keeps one
 * definition that works in both worlds.
 *
 * Recolors by `colorScheme` with concrete hex (CSS custom properties don't
 * resolve in satori) — see `./brand`'s `MARK_STROKE`. The legacy parametric
 * "dual-A" props are accepted for API compatibility but ignored — the mark
 * is a single-stroke symbol.
 */

export function LogoIcon({
  ref,
  colorScheme = "primary",
  size = 80,
  colors,
  className,
  style,
  // ── Legacy "dual-A" props: accepted for API compat, intentionally unused so
  //    they don't spread onto the <svg> as invalid attributes. ──
  angle: _angle,
  weight: _weight,
  detail: _detail,
  weights: _weights,
  shadowRect: _shadowRect,
  mainRect: _mainRect,
  leftShaft: _leftShaft,
  rightShaft: _rightShaft,
  leftSerifCap: _leftSerifCap,
  rightSerifCap: _rightSerifCap,
  leftBracket: _leftBracket,
  rightBracket: _rightBracket,
  leftFootSerif: _leftFootSerif,
  rightFootSerif: _rightFootSerif,
  rotatedA: _rotatedA,
  innerHairline: _innerHairline,
  hCrossbar: _hCrossbar,
  vCrossbar: _vCrossbar,
  leftOuterHairline: _leftOuterHairline,
  rightOuterHairline: _rightOuterHairline,
  ...svgProps
}: LogoIconProps) {
  const stroke = colors?.stroke ?? MARK_STROKE[colorScheme] ?? "currentColor";
  // Mirror lucide's `absoluteStrokeWidth` (constant ~1.75px regardless of size):
  // strokeWidth is in viewBox units, so scale it by 24/size.
  const strokeWidth = (1.75 * 24) / Number(size);
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={brand.ariaLabel}
      className={className}
      style={style}
      {...svgProps}
    >
      {/* Optional enclosing geometry (zero-radius for the asterisk mark). */}
      <circle cx="12" cy="12" r={markPaths.circleRadius} />
      {/* Brand-surface paths. */}
      {markPaths.ticks.map((d) => (
        <path key={d} d={d} />
      ))}
      {/* Center point. */}
      <circle cx="12" cy="12" r={markPaths.centerRadius} fill={stroke} stroke="none" />
    </svg>
  );
}
