import { cn } from "@si/ui/lib/utils";
import { brand } from "./brand";
import type { LogoProps } from "./types";
import { LogoIcon } from "./logo-icon";

/**
 * Top-level platform logo component. Composes `LogoIcon` with the wordmark.
 * The rendered text always comes from `./brand`'s `LogoBrand`
 * (`wordmarkFull` / `wordmarkShort`), so forks get their own wordmark by
 * editing that one file — no change needed here.
 *
 * Composes `LogoIcon` with a wordmark in one of four layouts:
 * - `icon` — mark only (default)
 * - `horizontal` — mark + wordmark side by side
 * - `stacked` — mark over uppercase wordmark
 * - `compact` — small mark + wordmark for navs/headers
 */
export function Logo({
  layout = "icon",
  className,
  style,
  iconProps,
  angle,
  weight,
  detail,
  colorScheme,
  size,
  colors,
  weights,
  shadowRect,
  mainRect,
  leftShaft,
  rightShaft,
  leftSerifCap,
  rightSerifCap,
  leftBracket,
  rightBracket,
  leftFootSerif,
  rightFootSerif,
  rotatedA,
  innerHairline,
  hCrossbar,
  vCrossbar,
  leftOuterHairline,
  rightOuterHairline,
}: LogoProps) {
  const sharedIconProps = {
    angle,
    weight,
    detail,
    colorScheme,
    colors,
    weights,
    shadowRect,
    mainRect,
    leftShaft,
    rightShaft,
    leftSerifCap,
    rightSerifCap,
    leftBracket,
    rightBracket,
    leftFootSerif,
    rightFootSerif,
    rotatedA,
    innerHairline,
    hCrossbar,
    vCrossbar,
    leftOuterHairline,
    rightOuterHairline,
    ...iconProps,
  };

  if (layout === "icon") {
    return <LogoIcon size={size ?? 80} className={className} style={style} {...sharedIconProps} />;
  }

  if (layout === "horizontal") {
    const iconSize = size ?? 56;
    return (
      <div
        className={cn("flex items-center", className)}
        style={{ gap: iconSize * 0.12, ...style }}
      >
        <LogoIcon size={iconSize} {...sharedIconProps} />
        <span
          className="font-display font-light tracking-[0.04em] leading-none"
          style={{ fontSize: iconSize * 0.72 }}
        >
          {brand.wordmarkFull}
        </span>
      </div>
    );
  }

  if (layout === "stacked") {
    return (
      <div className={cn("flex flex-col items-center gap-1", className)} style={style}>
        <LogoIcon size={size ?? 64} {...sharedIconProps} />
        <span className="font-display text-lg font-light tracking-[0.12em] leading-none uppercase">
          {brand.wordmarkShort}
        </span>
      </div>
    );
  }

  // compact
  return (
    <div className={cn("flex items-center gap-2.5", className)} style={style}>
      <LogoIcon size={size ?? 36} {...sharedIconProps} />
      <span className="font-display text-2xl font-light tracking-[0.04em] leading-none">
        {brand.wordmarkFull}
      </span>
    </div>
  );
}
