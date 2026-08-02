import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "outline",
        "ghost",
        "destructive",
        "link",
        "neo",
        "glass",
        "success",
      ],
    },
    size: {
      control: "select",
      options: ["xs", "sm", "default", "lg", "xl", "icon", "icon-sm", "icon-lg"],
    },
  },
  args: {
    children: "Button",
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Brutalist (Default)",
  args: { children: "Primary" },
};

export const Success: Story = {
  name: "Verdigris / Confirm",
  args: { variant: "success", children: "Confirm" },
};

export const Secondary: Story = {
  name: "Soft / Secondary",
  args: { variant: "secondary", children: "Secondary" },
};

export const Neo: Story = {
  name: "Neumorphic",
  args: { variant: "neo", children: "Neumorphic" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Ghost" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "Delete" },
};

export const Glass: Story = {
  args: { variant: "glass", children: "Glass" },
  decorators: [
    (Story) => (
      <div className="rounded-sm bg-gradient-to-br from-primary/30 via-destructive/20 to-success/30 p-8">
        <Story />
      </div>
    ),
  ],
};

export const Outline: Story = {
  args: { variant: "outline", children: "Outline" },
};

export const Link: Story = {
  args: { variant: "link", children: "Link" },
};

/** Matches the button row in the design system demo */
export const DesignDemoShowcase: Story = {
  name: "Design Demo Showcase",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Primary</Button>
      <Button variant="success">Confirm</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="neo">Neumorphic</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="glass">Glass</Button>
      <Button variant="destructive">Delete</Button>
    </div>
  ),
  parameters: { layout: "padded" },
};

export const AllVariants: Story = {
  render: () => {
    const variants = [
      "default",
      "secondary",
      "outline",
      "ghost",
      "destructive",
      "link",
      "neo",
      "glass",
      "success",
    ] as const;
    const textSizes = ["xs", "sm", "default", "lg", "xl"] as const;
    const iconSizes = ["icon-sm", "icon", "icon-lg"] as const;

    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <p className="type-section-label text-muted-foreground">Text Sizes</p>
          <div className="flex items-end gap-4">
            <span className="type-mono-label w-24 text-muted-foreground/80" />
            {textSizes.map((size) => (
              <span
                key={size}
                className="type-mono-label w-24 text-center text-muted-foreground/80"
              >
                {size}
              </span>
            ))}
          </div>
          {variants.map((variant) => (
            <div key={variant} className="flex items-center gap-4">
              <span className="type-mono-label w-24 text-muted-foreground/80">{variant}</span>
              {textSizes.map((size) => (
                <div key={size} className="flex w-24 justify-center">
                  <Button variant={variant} size={size}>
                    {variant === "link" ? "Link" : "Btn"}
                  </Button>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          <p className="type-section-label text-muted-foreground">Icon Sizes</p>
          <div className="flex items-end gap-4">
            <span className="type-mono-label w-24 text-muted-foreground/80" />
            {iconSizes.map((size) => (
              <span
                key={size}
                className="type-mono-label w-24 text-center text-muted-foreground/80"
              >
                {size}
              </span>
            ))}
          </div>
          {variants
            .filter((v) => v !== "link")
            .map((variant) => (
              <div key={variant} className="flex items-center gap-4">
                <span className="type-mono-label w-24 text-muted-foreground/80">{variant}</span>
                {iconSizes.map((size) => (
                  <div key={size} className="flex w-24 justify-center">
                    <Button variant={variant} size={size}>
                      +
                    </Button>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    );
  },
  parameters: { layout: "padded" },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-3">
      <Button size="xs">Extra Small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="xl">Extra Large</Button>
    </div>
  ),
  parameters: { layout: "padded" },
};

export const Disabled: Story = {
  args: { disabled: true },
};
