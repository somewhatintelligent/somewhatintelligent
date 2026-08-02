import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./badge";

const meta = {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "destructive",
        "outline",
        "success",
        "warning",
        "inverse",
        "default-brutal",
        "destructive-brutal",
        "success-brutal",
        "warning-brutal",
        "default-glass",
        "destructive-glass",
        "success-glass",
        "warning-glass",
      ],
    },
    size: {
      control: "select",
      options: ["sm", "default", "lg"],
    },
  },
  args: {
    children: "Badge",
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Primary: Story = {
  args: { variant: "default", children: "Active" },
};

export const Verdigris: Story = {
  args: { variant: "success", children: "Published" },
};

export const Slate: Story = {
  args: { variant: "secondary", children: "Info" },
};

export const Ochre: Story = {
  args: { variant: "warning", children: "Pending" },
};

export const Blood: Story = {
  args: { variant: "destructive", children: "Error" },
};

export const Outline: Story = {
  args: { variant: "outline", children: "Draft" },
};

export const Secondary: Story = {
  args: { variant: "secondary" },
};

export const Destructive: Story = {
  args: { variant: "destructive" },
};

export const Inverse: Story = {
  args: { variant: "inverse", children: "Inverse" },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-4">
      <Badge size="sm" variant="default">
        Small
      </Badge>
      <Badge size="default" variant="default">
        Default
      </Badge>
      <Badge size="lg" variant="default">
        Large
      </Badge>
    </div>
  ),
  parameters: { layout: "padded" },
};

/** Matches the badge row in the design system demo */
export const DesignDemoShowcase: Story = {
  name: "Design Demo Showcase",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="default">Active</Badge>
      <Badge variant="success">Published</Badge>
      <Badge variant="secondary">Info</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="destructive">Error</Badge>
      <Badge variant="outline">Draft</Badge>
    </div>
  ),
  parameters: { layout: "padded" },
};

export const AllVariants: Story = {
  render: () => {
    const sizes = ["sm", "default", "lg"] as const;
    const baseVariants = ["default", "secondary", "destructive", "outline", "inverse"] as const;
    const solidVariants = ["default", "destructive", "success", "warning"] as const;
    const brutalVariants = [
      "default-brutal",
      "destructive-brutal",
      "success-brutal",
      "warning-brutal",
    ] as const;
    const glassVariants = [
      "default-glass",
      "destructive-glass",
      "success-glass",
      "warning-glass",
    ] as const;

    const renderGroup = (label: string, variants: readonly string[]) => (
      <div className="flex flex-col gap-3">
        <p className="type-section-label text-muted-foreground">{label}</p>
        {sizes.map((size) => (
          <div key={size} className="flex flex-wrap items-center gap-3">
            <span className="type-mono-label w-16 text-muted-foreground/80">{size}</span>
            {variants.map((variant) => (
              <Badge key={`${variant}-${size}`} variant={variant as any} size={size}>
                {variant.replace(/-brutal$/, "").replace(/-glass$/, "")}
              </Badge>
            ))}
          </div>
        ))}
      </div>
    );

    return (
      <div className="flex flex-col gap-8">
        {renderGroup("Base", baseVariants)}
        {renderGroup("Solid", solidVariants)}
        {renderGroup("Brutalist", brutalVariants)}
        {renderGroup("Glass", glassVariants)}
      </div>
    );
  },
  parameters: { layout: "padded" },
};
