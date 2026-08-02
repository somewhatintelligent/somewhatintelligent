import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { LogoIcon } from "./logo-icon";
import type { LogoAngle, LogoColorScheme, LogoDetail, LogoWeight } from "./types";
import type { ComponentProps } from "react";

const ANGLES: LogoAngle[] = ["tight", "narrow", "standard", "wide"];
const WEIGHTS: LogoWeight[] = ["hairline", "light", "standard", "medium", "heavy", "ultra"];
const DETAILS: LogoDetail[] = ["bare", "serifs", "crossbars", "brackets", "full"];
const COLOR_SCHEMES: LogoColorScheme[] = [
  "primary",
  "light",
  "mono-light",
  "mono-dark",
  "on-destructive",
  "on-success",
];

function isDarkScheme(cs: LogoColorScheme) {
  return !["light", "mono-dark"].includes(cs);
}

function SchemeBg({ scheme, children }: { scheme: LogoColorScheme; children: React.ReactNode }) {
  const dark = isDarkScheme(scheme);
  return (
    <div
      className={`inline-flex p-5 rounded-sm border ${dark ? "bg-bg border-border" : "bg-[hsl(40_15%_93%)] border-border"}`}
      data-theme={dark ? "dark" : "light"}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Brand/LogoIcon",
  component: LogoIcon,
  tags: ["autodocs"],
  argTypes: {
    angle: { control: "select", options: ANGLES },
    weight: { control: "select", options: WEIGHTS },
    detail: { control: "select", options: DETAILS },
    colorScheme: { control: "select", options: COLOR_SCHEMES },
    size: { control: { type: "range", min: 16, max: 256, step: 8 } },
  },
  args: {
    angle: "standard",
    weight: "standard",
    detail: "full",
    colorScheme: "primary",
    size: 128,
  },
  decorators: [
    (Story, { args }) => (
      <SchemeBg scheme={args.colorScheme ?? "primary"}>
        <Story />
      </SchemeBg>
    ),
  ],
} satisfies Meta<typeof LogoIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// ── Angle variants ──

export const AngleTight: Story = { args: { angle: "tight" }, name: "Angle / Tight (~12°)" };
export const AngleNarrow: Story = { args: { angle: "narrow" }, name: "Angle / Narrow (~18°)" };
export const AngleStandard: Story = {
  args: { angle: "standard" },
  name: "Angle / Standard (~22°)",
};
export const AngleWide: Story = { args: { angle: "wide" }, name: "Angle / Wide (~28°)" };

export const AllAngles: Story = {
  name: "Angle / All",
  render: (args) => (
    <div className="flex gap-6 flex-wrap">
      {ANGLES.map((a) => (
        <div key={a} className="flex flex-col items-center gap-2">
          <LogoIcon {...args} angle={a} />
          <span className="text-mono-label text-foreground uppercase">{a}</span>
        </div>
      ))}
    </div>
  ),
};

// ── Weight variants ──

export const AllWeights: Story = {
  name: "Weight / All",
  render: (args) => (
    <div className="flex gap-6 flex-wrap">
      {WEIGHTS.map((w) => (
        <div key={w} className="flex flex-col items-center gap-2">
          <LogoIcon {...args} weight={w} />
          <span className="text-mono-label text-foreground uppercase">{w}</span>
        </div>
      ))}
    </div>
  ),
};

// ── Detail levels ──

export const AllDetails: Story = {
  name: "Detail / All",
  render: (args) => (
    <div className="flex gap-6 flex-wrap">
      {DETAILS.map((d) => (
        <div key={d} className="flex flex-col items-center gap-2">
          <LogoIcon {...args} detail={d} />
          <span className="text-mono-label text-foreground uppercase">{d}</span>
        </div>
      ))}
    </div>
  ),
};

// ── Color schemes ──

export const AllColorSchemes: Story = {
  name: "Color / All Schemes",
  decorators: [],
  render: (args) => (
    <div className="flex gap-6 flex-wrap">
      {COLOR_SCHEMES.map((cs) => (
        <div key={cs} className="flex flex-col items-center gap-2">
          <SchemeBg scheme={cs}>
            <LogoIcon {...args} colorScheme={cs} />
          </SchemeBg>
          <span className="text-mono-label text-foreground uppercase">{cs}</span>
        </div>
      ))}
    </div>
  ),
};

// ── Size / graceful degradation ──

export const ScaleCheck: Story = {
  name: "Scale / Graceful Degradation",
  render: (args) => (
    <div className="flex gap-4 items-end">
      {[128, 64, 48, 32, 24, 16].map((s) => (
        <div key={s} className="flex flex-col items-center gap-1.5">
          <LogoIcon {...args} size={s} />
          <span className="text-mono-label text-foreground">{s}px</span>
        </div>
      ))}
    </div>
  ),
};

// ── Custom weight (numeric) ──

export const CustomWeight: Story = {
  name: "Weight / Custom (10px)",
  args: { weight: 10 as unknown as "standard" },
};

// ── Element overrides ──

export const HiddenElements: Story = {
  name: "Overrides / Hidden Elements",
  args: {
    shadowRect: false,
    innerHairline: false,
    leftOuterHairline: false,
    rightOuterHairline: false,
  },
};

export const CustomElementColors: Story = {
  name: "Overrides / Custom Element Colors",
  args: {
    rotatedA: { stroke: "var(--color-destructive)" },
    hCrossbar: { stroke: "var(--color-success)" },
    vCrossbar: { stroke: "var(--color-success)" },
  },
};

// ── Stroke draw-in animation ──

/**
 * Mirrors the exact HTML mockup animation choreography:
 *
 * +50ms  — main-rect scales from 0.85 → 1 with bouncy ease (0.5s)
 * +100ms — shadow-rect fades in (0.8s)
 * +200ms — draw-line strokes draw in via dashoffset, each +80ms stagger (1.2s)
 * +600ms — detail-line strokes draw in, each +60ms stagger (0.8s)
 * +800ms — crossbar strokes fade in, each +100ms stagger (0.4s)
 */
function DrawInIcon({ delay = 0, ...props }: ComponentProps<typeof LogoIcon> & { delay?: number }) {
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

    // ── Reset everything to hidden ──
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

    // Force reflow
    svg.getBoundingClientRect();

    const timers: ReturnType<typeof setTimeout>[] = [];

    // +50ms — main rect bounces in
    timers.push(
      setTimeout(() => {
        if (mainRect) {
          mainRect.style.transition =
            "opacity 0.5s cubic-bezier(0.34,1.56,0.64,1), transform 0.5s cubic-bezier(0.34,1.56,0.64,1)";
          mainRect.style.opacity = "1";
          mainRect.style.transform = "scale(1)";
        }
      }, delay + 50),
    );

    // +100ms — shadow rect fades in
    timers.push(
      setTimeout(() => {
        if (shadowRect) {
          shadowRect.style.transition = "opacity 0.8s ease";
          shadowRect.style.opacity = "1";
        }
      }, delay + 100),
    );

    // +200ms — draw-line strokes draw in, each staggered +80ms
    drawLines.forEach((el, i) => {
      timers.push(
        setTimeout(
          () => {
            el.style.transition = "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)";
            el.style.strokeDashoffset = "0";
          },
          delay + 200 + i * 80,
        ),
      );
    });

    // +600ms — detail-line strokes draw in, each staggered +60ms
    detailLines.forEach((el, i) => {
      timers.push(
        setTimeout(
          () => {
            el.style.transition = "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)";
            el.style.strokeDashoffset = "0";
          },
          delay + 600 + i * 60,
        ),
      );
    });

    // +800ms — crossbars fade in, each staggered +100ms
    crossbars.forEach((el, i) => {
      timers.push(
        setTimeout(
          () => {
            el.style.transition = "opacity 0.4s ease, stroke-dashoffset 0.4s ease";
            el.style.opacity = "1";
            el.style.strokeDashoffset = "0";
          },
          delay + 800 + i * 100,
        ),
      );
    });

    return () => timers.forEach(clearTimeout);
  }, [delay]);

  return <LogoIcon ref={svgRef} {...props} />;
}

function ReplayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-2xs uppercase tracking-caps text-muted-foreground/80 bg-surface-raised border border-border px-4 py-2 rounded-sm hover:text-foreground hover:border-foreground transition-colors"
      onClick={onClick}
    >
      Replay
    </button>
  );
}

export const StrokeDrawIn: Story = {
  name: "Animation / Stroke Draw-In",
  render: (args) => {
    const [key, setKey] = useState(0);
    return (
      <div className="flex flex-col items-start gap-4">
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
        <DrawInIcon
          key={key}
          size={args.size}
          angle={args.angle}
          weight={args.weight}
          detail={args.detail}
          colorScheme={args.colorScheme}
        />
      </div>
    );
  },
};

export const StrokeDrawInGrid: Story = {
  name: "Animation / Draw-In Grid (staggered)",
  render: (args) => {
    const [key, setKey] = useState(0);
    return (
      <div className="flex flex-col items-start gap-6">
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
        <div className="flex gap-7 flex-wrap">
          {DETAILS.map((d, di) => (
            <div key={d} className="flex flex-col items-center gap-2">
              <DrawInIcon
                key={`${d}-${key}`}
                size={180}
                detail={d}
                delay={di * 300}
                angle={args.angle}
                weight={args.weight}
                colorScheme={args.colorScheme}
              />
              <span className="text-mono-label text-foreground uppercase">{d}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

export const StrokeDrawInAngles: Story = {
  name: "Animation / Draw-In Angles",
  render: (args) => {
    const [key, setKey] = useState(0);
    return (
      <div className="flex flex-col items-start gap-6">
        <ReplayButton onClick={() => setKey((k) => k + 1)} />
        <div className="flex gap-7 flex-wrap">
          {ANGLES.map((a, ai) => (
            <div key={a} className="flex flex-col items-center gap-2">
              <DrawInIcon
                key={`${a}-${key}`}
                size={180}
                angle={a}
                delay={ai * 400}
                weight={args.weight}
                detail={args.detail}
                colorScheme={args.colorScheme}
              />
              <span className="text-mono-label text-foreground uppercase">{a}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

// ── Cartesian: Size × Color × Detail ──

const SIZES = [128, 64, 32, 16] as const;

export const CartesianSizeColorDetail: Story = {
  name: "Matrix / Size × Color × Detail",
  decorators: [],
  render: () => (
    <div className="flex flex-col gap-10">
      {COLOR_SCHEMES.map((cs) => {
        const dark = isDarkScheme(cs);
        return (
          <div key={cs} className="flex flex-col gap-3">
            <span className="text-mono-label text-foreground uppercase">{cs}</span>
            <div
              className={`rounded-sm border p-6 ${dark ? "bg-bg border-border" : "bg-[hsl(40_15%_93%)] border-border"}`}
              data-theme={dark ? "dark" : "light"}
            >
              <table className="border-collapse">
                <thead>
                  <tr>
                    <th />
                    {SIZES.map((s) => (
                      <th
                        key={s}
                        className="px-3 pb-2 text-mono-label text-muted-foreground/80 font-normal"
                      >
                        {s}px
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DETAILS.map((d) => (
                    <tr key={d}>
                      <td className="pr-4 py-2 text-mono-label text-muted-foreground align-middle">
                        {d}
                      </td>
                      {SIZES.map((s) => (
                        <td key={s} className="px-3 py-2 align-bottom">
                          <LogoIcon size={s} detail={d} colorScheme={cs} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  ),
};
