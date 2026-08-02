import type { Meta, StoryObj } from "@storybook/react";
import { Logo } from "./logo";
import type { LogoColorScheme, LogoLayout } from "./types";

const LAYOUTS: LogoLayout[] = ["icon", "horizontal", "stacked", "compact"];

function SchemeBg({ scheme, children }: { scheme: LogoColorScheme; children: React.ReactNode }) {
  const dark = !["light", "mono-dark"].includes(scheme);
  return (
    <div
      className={`inline-flex p-8 rounded-sm border ${dark ? "bg-bg border-border" : "bg-[hsl(40_15%_93%)] border-border"}`}
      data-theme={dark ? "dark" : "light"}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Brand/Logo",
  component: Logo,
  tags: ["autodocs"],
  argTypes: {
    layout: { control: "select", options: LAYOUTS },
    angle: {
      control: "select",
      options: ["tight", "narrow", "standard", "wide"],
    },
    weight: {
      control: "select",
      options: ["hairline", "light", "standard", "medium", "heavy", "ultra"],
    },
    detail: {
      control: "select",
      options: ["bare", "serifs", "crossbars", "brackets", "full"],
    },
    colorScheme: {
      control: "select",
      options: ["primary", "light", "mono-light", "mono-dark", "on-destructive", "on-success"],
    },
    size: { control: { type: "range", min: 16, max: 256, step: 8 } },
  },
  args: {
    layout: "horizontal",
    angle: "standard",
    weight: "standard",
    detail: "full",
    colorScheme: "primary",
  },
  decorators: [
    (Story, { args }) => (
      <SchemeBg scheme={args.colorScheme ?? "primary"}>
        <div className="text-foreground">
          <Story />
        </div>
      </SchemeBg>
    ),
  ],
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// ── Layout variants ──

export const AllLayouts: Story = {
  name: "Layout / All",
  render: (args) => (
    <div className="flex flex-col gap-10 items-start">
      {LAYOUTS.map((l) => (
        <div key={l} className="flex flex-col gap-2">
          <span className="text-mono-label text-muted-foreground uppercase">{l}</span>
          <Logo {...args} layout={l} />
        </div>
      ))}
    </div>
  ),
};

export const LayoutIcon: Story = {
  name: "Layout / Icon",
  args: { layout: "icon", size: 80 },
};

export const LayoutHorizontal: Story = {
  name: "Layout / Horizontal",
  args: { layout: "horizontal" },
};

export const LayoutStacked: Story = {
  name: "Layout / Stacked",
  args: { layout: "stacked" },
};

export const LayoutCompact: Story = {
  name: "Layout / Compact",
  args: { layout: "compact" },
};

// ── Nav example ──

export const NavHeader: Story = {
  name: "Use Case / Nav Header",
  args: { layout: "compact" },
  decorators: [
    (Story) => (
      <div
        className="flex items-center gap-6 bg-surface-raised px-4 py-2 border-b border-border"
        data-theme="dark"
      >
        <div className="text-foreground">
          <Story />
        </div>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <span>Blog</span>
          <span>Projects</span>
          <span>About</span>
        </nav>
      </div>
    ),
  ],
};

// ── Light mode ──

export const LightMode: Story = {
  name: "Color / Light Mode",
  args: { colorScheme: "light", layout: "horizontal" },
};

// ── Color + layout matrix ──

export const ColorLayoutMatrix: Story = {
  name: "Matrix / Color × Layout",
  decorators: [],
  render: () => (
    <div className="flex flex-col gap-8">
      {(
        ["primary", "light", "mono-light", "mono-dark", "on-destructive", "on-success"] as const
      ).map((cs) => (
        <div key={cs} className="flex flex-col gap-2">
          <span className="text-mono-label text-foreground uppercase">{cs}</span>
          <SchemeBg scheme={cs}>
            <div className="flex gap-8 items-center text-foreground">
              <Logo layout="icon" size={48} colorScheme={cs} />
              <Logo layout="horizontal" colorScheme={cs} />
              <Logo layout="compact" colorScheme={cs} />
            </div>
          </SchemeBg>
        </div>
      ))}
    </div>
  ),
};
