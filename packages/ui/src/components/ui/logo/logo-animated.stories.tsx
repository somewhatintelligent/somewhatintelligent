import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { LogoAnimated, type LogoAnimation } from "./logo-animated";

const ANIMATIONS: LogoAnimation[] = ["stagger", "scramble", "draw", "fade", "slide-up", "glitch"];

const meta = {
  title: "Brand/LogoAnimated",
  component: LogoAnimated,
  tags: ["autodocs"],
  argTypes: {
    animation: { control: "select", options: ANIMATIONS },
    layout: { control: "select", options: ["horizontal", "stacked", "compact"] },
    delay: { control: { type: "range", min: 0, max: 2000, step: 100 } },
    angle: { control: "select", options: ["tight", "narrow", "standard", "wide"] },
    weight: {
      control: "select",
      options: ["hairline", "light", "standard", "medium", "heavy", "ultra"],
    },
    detail: { control: "select", options: ["bare", "serifs", "crossbars", "brackets", "full"] },
    colorScheme: {
      control: "select",
      options: ["primary", "light", "mono-light", "mono-dark", "on-destructive", "on-success"],
    },
  },
  args: {
    animation: "stagger",
    layout: "horizontal",
    delay: 0,
    angle: "standard",
    weight: "standard",
    detail: "full",
    colorScheme: "primary",
  },
  decorators: [
    (Story, { args }) => {
      const dark = !["light", "mono-dark"].includes(args.colorScheme ?? "primary");
      return (
        <div
          className={`p-12 rounded-sm border ${dark ? "bg-bg border-border text-foreground" : "bg-[hsl(40_15%_93%)] border-border text-[hsl(30_30%_8%)]"}`}
          data-theme={dark ? "dark" : "light"}
        >
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof LogoAnimated>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Stagger: Story = {
  name: "Animation / Stagger",
  args: { animation: "stagger" },
};

export const Scramble: Story = {
  name: "Animation / Scramble",
  args: { animation: "scramble" },
};

export const Draw: Story = {
  name: "Animation / Draw",
  args: { animation: "draw" },
};

export const Fade: Story = {
  name: "Animation / Fade",
  args: { animation: "fade" },
};

export const SlideUp: Story = {
  name: "Animation / Slide Up",
  args: { animation: "slide-up" },
};

export const Glitch: Story = {
  name: "Animation / Glitch",
  args: { animation: "glitch" },
};

// ── All animations side by side ──

export const AllAnimations: Story = {
  name: "All Animations",
  render: () => {
    const [key, setKey] = useState(0);
    return (
      <div className="flex flex-col gap-10">
        <button
          type="button"
          className="self-start text-2xs uppercase tracking-caps text-muted-foreground/80 bg-surface-raised border border-border px-4 py-2 rounded-sm hover:text-foreground hover:border-foreground transition-colors"
          onClick={() => setKey((k) => k + 1)}
        >
          Replay all
        </button>
        {ANIMATIONS.map((a) => (
          <div key={a} className="flex flex-col gap-2">
            <span className="text-mono-label text-muted-foreground/80 uppercase">{a}</span>
            <LogoAnimated animation={a} layout="horizontal" triggerKey={key} />
          </div>
        ))}
      </div>
    );
  },
  decorators: [
    (Story) => (
      <div className="bg-bg p-12 rounded-sm border border-border text-foreground" data-theme="dark">
        <Story />
      </div>
    ),
  ],
};

// ── Stacked layout with scramble ──

export const StackedScramble: Story = {
  name: "Layout / Stacked + Scramble",
  args: { animation: "scramble", layout: "stacked" },
};

// ── Compact with glitch ──

export const CompactGlitch: Story = {
  name: "Layout / Compact + Glitch",
  args: { animation: "glitch", layout: "compact" },
};

// ── Narrow angle with draw ──

export const NarrowDraw: Story = {
  name: "Variant / Narrow + Draw",
  args: { animation: "draw", angle: "narrow" },
};

// ── Heavy weight stagger ──

export const HeavyStagger: Story = {
  name: "Variant / Heavy + Stagger",
  args: { animation: "stagger", weight: "heavy" },
};

// ── Light mode scramble ──

export const LightScramble: Story = {
  name: "Color / Light + Scramble",
  args: { animation: "scramble", colorScheme: "light" },
};

// ── On stigma glitch ──

export const BloodGlitch: Story = {
  name: "Color / Blood + Glitch",
  args: { animation: "glitch", colorScheme: "on-destructive" },
};

// ── Matrix: Animation × Layout ──

export const AnimationLayoutMatrix: Story = {
  name: "Matrix / Animation × Layout",
  decorators: [
    (Story) => (
      <div className="bg-bg p-12 rounded-sm border border-border text-foreground" data-theme="dark">
        <Story />
      </div>
    ),
  ],
  render: () => {
    const [key, setKey] = useState(0);
    const layouts = ["horizontal", "stacked", "compact"] as const;
    return (
      <div className="flex flex-col gap-6">
        <button
          type="button"
          className="self-start text-2xs uppercase tracking-caps text-muted-foreground/80 bg-surface-raised border border-border px-4 py-2 rounded-sm hover:text-foreground hover:border-foreground transition-colors"
          onClick={() => setKey((k) => k + 1)}
        >
          Replay all
        </button>
        <table className="border-collapse">
          <thead>
            <tr>
              <th />
              {layouts.map((l) => (
                <th
                  key={l}
                  className="px-6 pb-3 text-mono-label text-muted-foreground/80 font-normal"
                >
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ANIMATIONS.map((a) => (
              <tr key={a}>
                <td className="pr-6 py-4 text-mono-label text-muted-foreground align-middle">
                  {a}
                </td>
                {layouts.map((l) => (
                  <td key={l} className="px-6 py-4 align-middle">
                    <LogoAnimated
                      animation={a}
                      layout={l}
                      triggerKey={key}
                      delay={ANIMATIONS.indexOf(a) * 200}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
};
