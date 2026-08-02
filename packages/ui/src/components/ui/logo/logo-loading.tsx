"use client";

import { useEffect, useRef } from "react";
import { cn } from "@si/ui/lib/utils";
import { GEOMETRIES, resolveColors, resolveWeights } from "./presets";
import type { LogoColorScheme } from "./types";

// Element metadata — matches render order of data-loading-stroke elements
const STROKE_META: { side: "left" | "right" | "center"; tier: "main" | "detail" }[] = [
  { side: "left", tier: "main" }, // 0: left shaft
  { side: "right", tier: "main" }, // 1: right shaft
  { side: "left", tier: "detail" }, // 2: left serif
  { side: "right", tier: "detail" }, // 3: right serif
  { side: "left", tier: "detail" }, // 4: left foot
  { side: "right", tier: "detail" }, // 5: right foot
  { side: "center", tier: "main" }, // 6: chevron
  { side: "center", tier: "detail" }, // 7: h crossbar
  { side: "center", tier: "detail" }, // 8: v crossbar
];

// Stagger orderings for cycleOrigin
const STAGGER_ORDERS = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8], // sequential
  [8, 7, 6, 5, 4, 3, 2, 1, 0], // reversed
  [6, 7, 8, 0, 1, 2, 3, 4, 5], // center-out
  [2, 4, 3, 5, 0, 1, 6, 7, 8], // extremities-first
];

export interface LogoLoadingProps {
  /** Color scheme. @default "primary" */
  colorScheme?: LogoColorScheme;
  /** Rendered size in px. @default 80 */
  size?: number;
  /** Animation speed multiplier. @default 1 */
  speed?: number;
  /** Elements stagger their breathe timing in a wave. @default false */
  staggerBreathe?: boolean;
  /** Left and right sides breathe out of phase. @default false */
  alternateDirections?: boolean;
  /** Serifs and crossbars fully vanish on contraction. @default false */
  dissolveExtremities?: boolean;
  /** Rects gently scale-pulse in sync with breathing. @default false */
  rectPulse?: boolean;
  /** Shadow rect fades on contraction. @default false */
  shadowFade?: boolean;
  /** Rects rock ±3° in sync with breathing. @default false */
  rectWobble?: boolean;
  /** Strokes fade to 60% opacity on contraction. @default false */
  strokeFade?: boolean;
  /** Stagger order rotates each breathe cycle. @default false */
  cycleOrigin?: boolean;
  /** Dash position creeps along the path between cycles. @default false */
  dashShift?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function LogoLoading({
  colorScheme = "primary",
  size = 80,
  speed = 1,
  staggerBreathe = false,
  alternateDirections = false,
  dissolveExtremities = false,
  rectPulse = false,
  shadowFade = false,
  rectWobble = false,
  strokeFade = false,
  cycleOrigin = false,
  dashShift = false,
  className,
  style: styleProp,
}: LogoLoadingProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const colors = resolveColors(colorScheme);
  const w = resolveWeights("standard");
  const geo = GEOMETRIES.standard;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const mainRect = svg.querySelector("[data-loading-main]") as SVGElement | null;
    const shadowRect = svg.querySelector("[data-loading-shadow]") as SVGElement | null;
    const strokes = Array.from(
      svg.querySelectorAll("[data-loading-stroke]"),
    ) as SVGGeometryElement[];

    const timers: ReturnType<typeof setTimeout>[] = [];
    let breatheInterval: ReturnType<typeof setInterval> | null = null;

    const strokeData = strokes.map((el) => ({
      el,
      len: el.getTotalLength(),
    }));

    const offsets: number[] = Array.from({ length: strokes.length }, () => 0);
    let orderIdx = 0;
    let expanded = true;

    // ── Phase 1: Draw in ──

    if (mainRect) {
      mainRect.style.transition = "none";
      mainRect.style.opacity = "0";
      mainRect.style.transform = "scale(0.85)";
    }
    if (shadowRect) {
      shadowRect.style.transition = "none";
      shadowRect.style.opacity = "0";
    }

    strokeData.forEach(({ el, len }) => {
      el.style.transition = "none";
      el.style.strokeDasharray = `${len} ${len}`;
      el.style.strokeDashoffset = `${len}`;
      el.style.opacity = "1";
    });

    svg.getBoundingClientRect();

    timers.push(
      setTimeout(() => {
        if (mainRect) {
          mainRect.style.transition =
            "opacity 0.5s cubic-bezier(0.34,1.56,0.64,1), transform 0.5s cubic-bezier(0.34,1.56,0.64,1)";
          mainRect.style.opacity = "1";
          mainRect.style.transform = "scale(1)";
        }
      }, 50),
    );
    timers.push(
      setTimeout(() => {
        if (shadowRect) {
          shadowRect.style.transition = "opacity 0.8s ease";
          shadowRect.style.opacity = "1";
        }
      }, 100),
    );

    const drawDur = 1200 / speed;
    strokeData.forEach(({ el }, i) => {
      timers.push(
        setTimeout(
          () => {
            el.style.transition = `stroke-dashoffset ${drawDur}ms cubic-bezier(0.4,0,0.2,1)`;
            el.style.strokeDashoffset = "0";
          },
          200 + i * 80,
        ),
      );
    });

    // ── Phase 2: Breathe loop ──

    const lastStrokeStart = 200 + (strokes.length - 1) * 80;
    const drawDoneMs = lastStrokeStart + drawDur + 400;
    const breatheDur = 2000 / speed;
    const staggerStep = 120 / speed;

    function applyBreathe() {
      expanded = !expanded;
      const order = cycleOrigin ? STAGGER_ORDERS[orderIdx % STAGGER_ORDERS.length] : null;

      // ── Strokes ──

      strokeData.forEach(({ el, len }, i) => {
        const meta = STROKE_META[i]!;

        // Per-element phase (flip right-side elements when alternateDirections)
        let elExpanded = expanded;
        if (alternateDirections && meta.side === "right") {
          elExpanded = !elExpanded;
        }

        // Stagger delay
        const staggerRank = order ? order.indexOf(i) : i;
        const delay = staggerBreathe ? staggerRank * staggerStep : 0;

        // Dash length — detail elements vanish entirely when dissolveExtremities
        const minRatio = dissolveExtremities && meta.tier === "detail" ? 0 : 0.25;
        const dashLen = elExpanded ? len : len * minRatio;
        const gapLen = len - dashLen;

        // Dash position creep
        if (!elExpanded && dashShift) {
          offsets[i] = (offsets[i]! + len * 0.1) % len;
        }

        // Build transition string
        const props = ["stroke-dasharray"];
        if (dashShift) props.push("stroke-dashoffset");
        if (strokeFade) props.push("opacity");
        el.style.transition = props
          .map((p) => `${p} ${breatheDur}ms ease-in-out ${delay}ms`)
          .join(", ");

        el.style.strokeDasharray = `${dashLen} ${gapLen}`;
        if (dashShift) el.style.strokeDashoffset = `${offsets[i]!}`;
        if (strokeFade) el.style.opacity = elExpanded ? "1" : "0.6";
      });

      // ── Main rect ──

      if (mainRect && (rectPulse || rectWobble)) {
        const scale = rectPulse ? (expanded ? 1 : 1.025) : 1;
        const rotate = rectWobble ? (expanded ? 2.5 : -2.5) : 0;
        mainRect.style.transition = `transform ${breatheDur}ms ease-in-out`;
        mainRect.style.transform = `scale(${scale}) rotate(${rotate}deg)`;
      }

      // ── Shadow rect ──

      if (shadowRect) {
        const needsTransform = rectPulse || rectWobble;
        const props: string[] = [];
        if (shadowFade) props.push("opacity");
        if (needsTransform) props.push("transform");

        if (props.length > 0) {
          shadowRect.style.transition = props
            .map((p) => `${p} ${breatheDur}ms ease-in-out`)
            .join(", ");
        }

        if (shadowFade) shadowRect.style.opacity = expanded ? "1" : "0.4";

        if (needsTransform) {
          const scale = rectPulse ? (expanded ? 1 : 0.975) : 1;
          const rotate = rectWobble ? (expanded ? -2.5 : 2.5) : 0;
          shadowRect.style.transform = `scale(${scale}) rotate(${rotate}deg)`;
        }
      }

      // Advance stagger order on each full expand→contract cycle
      if (expanded && cycleOrigin) {
        orderIdx++;
      }
    }

    timers.push(
      setTimeout(() => {
        applyBreathe();
        breatheInterval = setInterval(applyBreathe, breatheDur);
      }, drawDoneMs),
    );

    return () => {
      timers.forEach(clearTimeout);
      if (breatheInterval) clearInterval(breatheInterval);
    };
  }, [
    speed,
    staggerBreathe,
    alternateDirections,
    dissolveExtremities,
    rectPulse,
    shadowFade,
    rectWobble,
    strokeFade,
    cycleOrigin,
    dashShift,
  ]);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 240 240"
      width={size}
      height={size}
      className={cn(className)}
      style={styleProp}
      aria-label="Loading"
      role="status"
    >
      {/* Shadow rectangle */}
      <rect
        data-loading-shadow
        x={40}
        y={40}
        width={192}
        height={192}
        rx={2}
        fill={colors.shadowRect}
        style={{ transformOrigin: "136px 136px" }}
      />

      {/* Main rectangle */}
      <rect
        data-loading-main
        x={24}
        y={24}
        width={192}
        height={192}
        rx={2}
        fill={colors.mainRect}
        style={{ transformOrigin: "120px 120px" }}
      />

      {/* 0: Left shaft */}
      <path
        data-loading-stroke
        d={geo.shafts[0]}
        fill="none"
        stroke={colors.stroke}
        strokeLinecap="round"
        strokeWidth={w.main}
      />
      {/* 1: Right shaft */}
      <path
        data-loading-stroke
        d={geo.shafts[1]}
        fill="none"
        stroke={colors.stroke}
        strokeLinecap="round"
        strokeWidth={w.main}
      />
      {/* 2: Left serif cap */}
      <line
        data-loading-stroke
        x1={geo.serifs[0][0]}
        y1={geo.serifs[0][1]}
        x2={geo.serifs[0][2]}
        y2={geo.serifs[0][3]}
        stroke={colors.stroke}
        strokeLinecap="round"
        strokeWidth={w.serif}
      />
      {/* 3: Right serif cap */}
      <line
        data-loading-stroke
        x1={geo.serifs[1][0]}
        y1={geo.serifs[1][1]}
        x2={geo.serifs[1][2]}
        y2={geo.serifs[1][3]}
        stroke={colors.stroke}
        strokeLinecap="round"
        strokeWidth={w.serif}
      />
      {/* 4: Left foot serif */}
      <line
        data-loading-stroke
        x1={geo.feet[0][0]}
        y1={geo.feet[0][1]}
        x2={geo.feet[0][2]}
        y2={geo.feet[0][3]}
        stroke={colors.stroke}
        strokeLinecap="round"
        strokeWidth={w.serif}
      />
      {/* 5: Right foot serif */}
      <line
        data-loading-stroke
        x1={geo.feet[1][0]}
        y1={geo.feet[1][1]}
        x2={geo.feet[1][2]}
        y2={geo.feet[1][3]}
        stroke={colors.stroke}
        strokeLinecap="round"
        strokeWidth={w.serif}
      />
      {/* 6: Rotated A (V chevron) */}
      <path
        data-loading-stroke
        d={geo.rot}
        fill="none"
        stroke={colors.stroke}
        strokeLinecap="round"
        strokeLinejoin="miter"
        strokeWidth={w.main}
      />
      {/* 7: Horizontal crossbar */}
      <path
        data-loading-stroke
        d={geo.hCross}
        fill="none"
        stroke={colors.stroke}
        strokeLinecap="round"
        strokeWidth={w.crossbar}
      />
      {/* 8: Vertical crossbar */}
      <path
        data-loading-stroke
        d={geo.vCross}
        fill="none"
        stroke={colors.stroke}
        strokeLinecap="round"
        strokeWidth={w.crossbar}
      />
    </svg>
  );
}
