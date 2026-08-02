import type { Meta, StoryObj } from "@storybook/react";
import { Bold, Italic, Underline } from "lucide-react";
import { Toggle } from "./toggle";

const meta = {
  title: "UI/Toggle",
  component: Toggle,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "outline"],
    },
    size: {
      control: "select",
      options: ["sm", "default", "lg"],
    },
  },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Default",
  args: {
    children: "Toggle",
  },
};

export const Outline: Story = {
  name: "Outline",
  args: {
    variant: "outline",
    children: "Outline",
  },
};

export const WithIcon: Story = {
  name: "With Icon",
  render: () => (
    <Toggle aria-label="Toggle bold">
      <Bold className="size-4" />
    </Toggle>
  ),
};

export const Disabled: Story = {
  name: "Disabled",
  args: {
    disabled: true,
    children: "Disabled",
  },
};

export const AllVariantsAndSizes: Story = {
  name: "All Variants and Sizes",
  render: () => {
    const variants = ["default", "outline"] as const;
    const sizes = ["sm", "default", "lg"] as const;

    return (
      <div className="flex flex-col gap-6">
        {variants.map((variant) => (
          <div key={variant} className="flex flex-col gap-2">
            <span className="type-mono-label text-muted-foreground/80">{variant}</span>
            <div className="flex items-end gap-3">
              {sizes.map((size) => (
                <Toggle key={size} variant={variant} size={size}>
                  {size}
                </Toggle>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  },
  parameters: { layout: "padded" },
};

export const IconToggles: Story = {
  name: "Icon Toggles",
  render: () => (
    <div className="flex items-center gap-2">
      <Toggle aria-label="Toggle bold">
        <Bold className="size-4" />
      </Toggle>
      <Toggle aria-label="Toggle italic">
        <Italic className="size-4" />
      </Toggle>
      <Toggle aria-label="Toggle underline">
        <Underline className="size-4" />
      </Toggle>
    </div>
  ),
  parameters: { layout: "padded" },
};
