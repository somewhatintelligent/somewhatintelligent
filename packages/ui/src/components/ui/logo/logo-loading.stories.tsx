import type { Meta, StoryObj } from "@storybook/react";
import { LogoLoading } from "./logo-loading";
import type { LogoColorScheme } from "./types";

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

// ── Shared effect-off base ──

const EFFECTS_OFF = {
  staggerBreathe: false,
  alternateDirections: false,
  dissolveExtremities: false,
  rectPulse: false,
  shadowFade: false,
  rectWobble: false,
  strokeFade: false,
  cycleOrigin: false,
  dashShift: false,
};

const meta = {
  title: "Brand/Loading",
  component: LogoLoading,
  tags: ["autodocs"],
  argTypes: {
    colorScheme: { control: "select", options: COLOR_SCHEMES },
    size: { control: { type: "range", min: 16, max: 256, step: 8 } },
    speed: { control: { type: "range", min: 0.25, max: 3, step: 0.25 } },
    staggerBreathe: { control: "boolean" },
    alternateDirections: { control: "boolean" },
    dissolveExtremities: { control: "boolean" },
    rectPulse: { control: "boolean" },
    shadowFade: { control: "boolean" },
    rectWobble: { control: "boolean" },
    strokeFade: { control: "boolean" },
    cycleOrigin: { control: "boolean" },
    dashShift: { control: "boolean" },
  },
  args: {
    colorScheme: "primary",
    size: 128,
    speed: 1,
    ...EFFECTS_OFF,
  },
  decorators: [
    (Story, { args }) => (
      <SchemeBg scheme={args.colorScheme ?? "primary"}>
        <Story />
      </SchemeBg>
    ),
  ],
} satisfies Meta<typeof LogoLoading>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default (breathe only) ──

export const Default: Story = {};

// ── Individual effects ──

export const StaggerBreathe: Story = {
  name: "Effect / Stagger Breathe",
  args: { staggerBreathe: true },
};

export const AlternateDirections: Story = {
  name: "Effect / Alternate Directions",
  args: { alternateDirections: true },
};

export const DissolveExtremities: Story = {
  name: "Effect / Dissolve Extremities",
  args: { dissolveExtremities: true },
};

export const RectPulse: Story = {
  name: "Effect / Rect Pulse",
  args: { rectPulse: true },
};

export const ShadowFade: Story = {
  name: "Effect / Shadow Fade",
  args: { shadowFade: true },
};

export const RectWobble: Story = {
  name: "Effect / Rect Wobble",
  args: { rectWobble: true },
};

export const StrokeFade: Story = {
  name: "Effect / Stroke Fade",
  args: { strokeFade: true },
};

export const CycleOrigin: Story = {
  name: "Effect / Cycle Origin",
  args: { cycleOrigin: true, staggerBreathe: true },
};

export const DashShift: Story = {
  name: "Effect / Dash Shift",
  args: { dashShift: true },
};

// ── Curated presets ──

export const Subtle: Story = {
  name: "Preset / Subtle",
  args: { strokeFade: true, shadowFade: true },
};

export const Organic: Story = {
  name: "Preset / Organic",
  args: { staggerBreathe: true, strokeFade: true, rectPulse: true, shadowFade: true },
};

export const Dramatic: Story = {
  name: "Preset / Dramatic",
  args: {
    staggerBreathe: true,
    dissolveExtremities: true,
    rectWobble: true,
    strokeFade: true,
    shadowFade: true,
  },
};

export const Chaotic: Story = {
  name: "Preset / Chaotic",
  args: {
    staggerBreathe: true,
    alternateDirections: true,
    dissolveExtremities: true,
    rectPulse: true,
    shadowFade: true,
    rectWobble: true,
    strokeFade: true,
    cycleOrigin: true,
    dashShift: true,
  },
};

// ── All color schemes ──

export const AllColorSchemes: Story = {
  name: "Color / All Schemes",
  decorators: [],
  args: { strokeFade: true, shadowFade: true },
  render: (args) => (
    <div className="flex gap-6 flex-wrap">
      {COLOR_SCHEMES.map((cs) => (
        <div key={cs} className="flex flex-col items-center gap-2">
          <SchemeBg scheme={cs}>
            <LogoLoading {...args} colorScheme={cs} />
          </SchemeBg>
          <span className="text-mono-label text-foreground uppercase">{cs}</span>
        </div>
      ))}
    </div>
  ),
};

export const AllColorSchemesDramatic: Story = {
  name: "Color / All Schemes (Dramatic)",
  decorators: [],
  args: {
    staggerBreathe: true,
    dissolveExtremities: true,
    rectWobble: true,
    strokeFade: true,
    shadowFade: true,
  },
  render: (args) => (
    <div className="flex gap-6 flex-wrap">
      {COLOR_SCHEMES.map((cs) => (
        <div key={cs} className="flex flex-col items-center gap-2">
          <SchemeBg scheme={cs}>
            <LogoLoading {...args} colorScheme={cs} />
          </SchemeBg>
          <span className="text-mono-label text-foreground uppercase">{cs}</span>
        </div>
      ))}
    </div>
  ),
};

// ── Size scale ──

export const SizeScale: Story = {
  name: "Size / Scale",
  args: { strokeFade: true, shadowFade: true },
  render: (args) => (
    <div className="flex gap-6 items-end">
      {[192, 128, 80, 48, 32].map((s) => (
        <div key={s} className="flex flex-col items-center gap-2">
          <LogoLoading {...args} size={s} />
          <span className="text-mono-label text-foreground">{s}px</span>
        </div>
      ))}
    </div>
  ),
};

// ── Effect comparison grid ──

const INDIVIDUAL_EFFECTS = [
  { label: "Breathe (base)", args: {} },
  { label: "Stagger", args: { staggerBreathe: true } },
  { label: "Alternate", args: { alternateDirections: true } },
  { label: "Dissolve", args: { dissolveExtremities: true } },
  { label: "Rect Pulse", args: { rectPulse: true } },
  { label: "Shadow Fade", args: { shadowFade: true } },
  { label: "Rect Wobble", args: { rectWobble: true } },
  { label: "Stroke Fade", args: { strokeFade: true } },
  { label: "Cycle Origin", args: { cycleOrigin: true, staggerBreathe: true } },
  { label: "Dash Shift", args: { dashShift: true } },
] as const;

export const EffectGrid: Story = {
  name: "Effect / Comparison Grid",
  parameters: { layout: "padded" },
  render: (baseArgs) => (
    <div className="grid grid-cols-3 gap-6">
      {INDIVIDUAL_EFFECTS.map(({ label, args }) => (
        <div key={label} className="flex flex-col items-center gap-2">
          <SchemeBg scheme={baseArgs.colorScheme ?? "primary"}>
            <LogoLoading {...baseArgs} {...EFFECTS_OFF} {...args} size={96} />
          </SchemeBg>
          <span className="text-mono-label text-foreground text-center">{label}</span>
        </div>
      ))}
    </div>
  ),
};
