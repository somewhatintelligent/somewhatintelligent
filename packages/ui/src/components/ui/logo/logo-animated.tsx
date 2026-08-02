"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  type Variants,
  type Transition,
  useReducedMotion,
} from "motion/react";
import { brand } from "./brand";
import { cn } from "@si/ui/lib/utils";
import type { LogoIconProps } from "./types";
import { LogoIcon } from "./logo-icon";

// ── Shared transitions ──

const spring: Transition = { type: "spring", stiffness: 120, damping: 18 };
const smooth: Transition = { duration: 0.8, ease: [0.22, 1, 0.36, 1] };

// ── Animation presets ──

export type LogoAnimation = "draw" | "scramble" | "stagger" | "fade" | "slide-up" | "glitch";

export interface LogoAnimatedProps extends Omit<LogoIconProps, "className" | "style"> {
  /** Animation style. @default "stagger" */
  animation?: LogoAnimation;
  /** Layout — only horizontal/stacked/compact (icon-only has no text to animate). @default "horizontal" */
  layout?: "horizontal" | "stacked" | "compact";
  /** Delay before animation starts (ms). @default 0 */
  delay?: number;
  /** Play animation on mount. @default true */
  autoPlay?: boolean;
  /** Key to re-trigger animation. Changing this remounts. */
  triggerKey?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

const LAYOUT_CONFIG = {
  horizontal: {
    container: "flex items-center gap-3",
    iconSize: 56,
    text: brand.wordmarkFull,
    textClass: "font-display text-[40px] font-light tracking-[0.04em] leading-none",
  },
  stacked: {
    container: "flex flex-col items-center gap-1",
    iconSize: 64,
    text: brand.wordmarkShort,
    textClass: "font-display text-lg font-light tracking-[0.12em] leading-none uppercase",
  },
  compact: {
    container: "flex items-center gap-2.5",
    iconSize: 36,
    text: brand.wordmarkFull,
    textClass: "font-display text-2xl font-light tracking-[0.04em] leading-none",
  },
} as const;

// ── Stagger: icon scales in, letters slide from right one-by-one ──

function StaggerVariant({
  iconSize,
  iconProps,
  textClass,
  text,
  delayMs,
}: {
  iconSize: number;
  iconProps: Omit<LogoIconProps, "size">;
  textClass: string;
  text: string;
  delayMs: number;
}) {
  const delay = delayMs / 1000;
  const iconVariants: Variants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { opacity: 1, scale: 1, transition: { ...smooth, delay } },
  };

  return (
    <>
      <motion.div variants={iconVariants} initial="hidden" animate="visible">
        <LogoIcon size={iconSize} {...iconProps} />
      </motion.div>
      <span className={cn(textClass, "flex")}>
        {text.split("").map((char, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              ...smooth,
              delay: delay + 0.15 + i * 0.06,
            }}
          >
            {char}
          </motion.span>
        ))}
      </span>
    </>
  );
}

// ── Fade: everything fades in together ──

function FadeVariant({
  iconSize,
  iconProps,
  textClass,
  text,
  delayMs,
}: {
  iconSize: number;
  iconProps: Omit<LogoIconProps, "size">;
  textClass: string;
  text: string;
  delayMs: number;
}) {
  return (
    <motion.div
      className="contents"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.2, ease: "easeOut", delay: delayMs / 1000 }}
    >
      <LogoIcon size={iconSize} {...iconProps} />
      <span className={textClass}>{text}</span>
    </motion.div>
  );
}

// ── Slide-up: icon and text slide up from below with stagger ──

function SlideUpVariant({
  iconSize,
  iconProps,
  textClass,
  text,
  delayMs,
}: {
  iconSize: number;
  iconProps: Omit<LogoIconProps, "size">;
  textClass: string;
  text: string;
  delayMs: number;
}) {
  const delay = delayMs / 1000;
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay }}
      >
        <LogoIcon size={iconSize} {...iconProps} />
      </motion.div>
      <motion.span
        className={textClass}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: delay + 0.12 }}
      >
        {text}
      </motion.span>
    </>
  );
}

// ── Scramble: icon fades in, text scrambles through random chars ──

function ScrambleVariant({
  iconSize,
  iconProps,
  textClass,
  text,
  delayMs,
}: {
  iconSize: number;
  iconProps: Omit<LogoIconProps, "size">;
  textClass: string;
  text: string;
  delayMs: number;
}) {
  const [display, setDisplay] = useState("");
  const [started, setStarted] = useState(false);
  const glyphs = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω†‡§¶∞≈≠√∫";

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), delayMs + 200);
    return () => clearTimeout(t);
  }, [delayMs]);

  useEffect(() => {
    if (!started) return;
    let pos = 0;
    const interval = setInterval(() => {
      if (pos > text.length) {
        clearInterval(interval);
        setDisplay(text);
        return;
      }
      const revealed = text.slice(0, pos);
      const scrambleCount = Math.min(2, text.length - pos);
      const scrambled = Array.from(
        { length: scrambleCount },
        () => glyphs[Math.floor(Math.random() * glyphs.length)],
      ).join("");
      setDisplay(revealed + scrambled);
      pos++;
    }, 60);
    return () => clearInterval(interval);
  }, [started, text, glyphs]);

  const delay = delayMs / 1000;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...smooth, delay }}
      >
        <LogoIcon size={iconSize} {...iconProps} />
      </motion.div>
      <motion.span
        className={textClass}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: delay + 0.15 }}
      >
        {display || "\u00A0"}
      </motion.span>
    </>
  );
}

// ── Draw: SVG strokes draw in via motion, text staggers in after ──

function DrawSvg({
  iconSize,
  iconProps,
  delayMs,
}: {
  iconSize: number;
  iconProps: Omit<LogoIconProps, "size">;
  delayMs: number;
}) {
  const delay = delayMs / 1000;
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const mainRect = svg.querySelector('[data-logo-part="main-rect"]') as SVGElement | null;
    const shadowRect = svg.querySelector('[data-logo-part="shadow-rect"]') as SVGElement | null;
    const drawLines = Array.from(
      svg.querySelectorAll('[data-logo-part="draw-line"]'),
    ) as SVGElement[];
    const detailLines = Array.from(
      svg.querySelectorAll('[data-logo-part="detail-line"]'),
    ) as SVGElement[];
    const crossbars = Array.from(
      svg.querySelectorAll('[data-logo-part="crossbar"]'),
    ) as SVGElement[];

    // Reset
    if (mainRect) {
      mainRect.style.transition = "none";
      mainRect.style.opacity = "0";
      mainRect.style.transform = "scale(0.85)";
      mainRect.style.transformOrigin = "center";
    }
    if (shadowRect) {
      shadowRect.style.transition = "none";
      shadowRect.style.opacity = "0";
    }
    const allStrokes = [...drawLines, ...detailLines, ...crossbars];
    allStrokes.forEach((el) => {
      el.style.transition = "none";
      if ("getTotalLength" in el) {
        const len = (el as SVGGeometryElement).getTotalLength();
        el.style.strokeDasharray = `${len}`;
        el.style.strokeDashoffset = `${len}`;
      }
    });
    crossbars.forEach((el) => {
      el.style.opacity = "0";
    });

    svg.getBoundingClientRect();

    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(
      setTimeout(() => {
        if (mainRect) {
          mainRect.style.transition =
            "opacity 0.5s cubic-bezier(0.34,1.56,0.64,1), transform 0.5s cubic-bezier(0.34,1.56,0.64,1)";
          mainRect.style.opacity = "1";
          mainRect.style.transform = "scale(1)";
        }
      }, delayMs + 50),
    );
    timers.push(
      setTimeout(() => {
        if (shadowRect) {
          shadowRect.style.transition = "opacity 0.8s ease";
          shadowRect.style.opacity = "1";
        }
      }, delayMs + 100),
    );
    drawLines.forEach((el, i) => {
      timers.push(
        setTimeout(
          () => {
            el.style.transition = "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)";
            el.style.strokeDashoffset = "0";
          },
          delayMs + 200 + i * 80,
        ),
      );
    });
    detailLines.forEach((el, i) => {
      timers.push(
        setTimeout(
          () => {
            el.style.transition = "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)";
            el.style.strokeDashoffset = "0";
          },
          delayMs + 600 + i * 60,
        ),
      );
    });
    crossbars.forEach((el, i) => {
      timers.push(
        setTimeout(
          () => {
            el.style.transition = "opacity 0.4s ease, stroke-dashoffset 0.4s ease";
            el.style.opacity = "1";
            el.style.strokeDashoffset = "0";
          },
          delayMs + 800 + i * 100,
        ),
      );
    });

    return () => timers.forEach(clearTimeout);
  }, [delayMs]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, delay: delay }}
    >
      <LogoIcon ref={svgRef} size={iconSize} {...iconProps} />
    </motion.div>
  );
}

function DrawVariant({
  iconSize,
  iconProps,
  textClass,
  text,
  delayMs,
}: {
  iconSize: number;
  iconProps: Omit<LogoIconProps, "size">;
  textClass: string;
  text: string;
  delayMs: number;
}) {
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowText(true), delayMs + 1400);
    return () => clearTimeout(t);
  }, [delayMs]);

  return (
    <>
      <DrawSvg iconSize={iconSize} iconProps={iconProps} delayMs={delayMs} />
      <AnimatePresence>
        {showText && (
          <span className={cn(textClass, "flex")}>
            {text.split("").map((char, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...smooth, delay: i * 0.05 }}
              >
                {char}
              </motion.span>
            ))}
          </span>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Glitch: rapid flicker + position jitter, then settle ──

function GlitchVariant({
  iconSize,
  iconProps,
  textClass,
  text,
  delayMs,
}: {
  iconSize: number;
  iconProps: Omit<LogoIconProps, "size">;
  textClass: string;
  text: string;
  delayMs: number;
}) {
  const delay = delayMs / 1000;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{
          opacity: [0, 1, 0.4, 1, 0.7, 1],
          x: [-8, 3, -2, 1, 0, 0],
          filter: ["blur(4px)", "blur(0px)", "blur(2px)", "blur(0px)", "blur(1px)", "blur(0px)"],
        }}
        transition={{ duration: 0.6, delay, times: [0, 0.2, 0.35, 0.5, 0.7, 1] }}
      >
        <LogoIcon size={iconSize} {...iconProps} />
      </motion.div>
      <span className={cn(textClass, "flex overflow-hidden")}>
        {text.split("").map((char, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{
              opacity: [0, 0.6, 1, 0.5, 1],
              y: [20, -3, 2, -1, 0],
            }}
            transition={{
              duration: 0.5,
              delay: delay + 0.1 + i * 0.04,
              times: [0, 0.3, 0.5, 0.7, 1],
            }}
          >
            {char}
          </motion.span>
        ))}
      </span>
    </>
  );
}

// ── Main component ──

export function LogoAnimated({
  animation = "stagger",
  layout = "horizontal",
  delay = 0,
  autoPlay = true,
  triggerKey,
  className,
  style,
  size,
  ...iconPassthrough
}: LogoAnimatedProps) {
  const prefersReduced = useReducedMotion();
  const config = LAYOUT_CONFIG[layout];
  const iconSize = size ?? config.iconSize;

  const iconProps: Omit<LogoIconProps, "size"> = { ...iconPassthrough };

  // Reduced motion: just render static
  if (prefersReduced || !autoPlay) {
    return (
      <div className={cn(config.container, className)} style={style}>
        <LogoIcon size={iconSize} {...iconProps} />
        <span className={config.textClass}>{config.text}</span>
      </div>
    );
  }

  const variantProps = {
    iconSize,
    iconProps,
    textClass: config.textClass,
    text: config.text,
    delayMs: delay,
  };

  const Variant = {
    stagger: StaggerVariant,
    fade: FadeVariant,
    "slide-up": SlideUpVariant,
    scramble: ScrambleVariant,
    draw: DrawVariant,
    glitch: GlitchVariant,
  }[animation];

  return (
    <div key={triggerKey} className={cn(config.container, className)} style={style}>
      <Variant {...variantProps} />
    </div>
  );
}
