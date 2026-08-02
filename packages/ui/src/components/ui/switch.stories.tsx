import type { Meta, StoryObj } from "@storybook/react";
import { Switch } from "./switch";
import { Label } from "./label";

const meta = {
  title: "UI/Switch",
  component: Switch,
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "default"],
    },
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Default",
};

export const Small: Story = {
  name: "Small",
  args: { size: "sm" },
};

export const CheckedByDefault: Story = {
  name: "Checked by Default",
  args: { defaultChecked: true },
};

export const Disabled: Story = {
  name: "Disabled",
  args: { disabled: true },
};

export const DisabledChecked: Story = {
  name: "Disabled (Checked)",
  args: { disabled: true, defaultChecked: true },
};

export const WithLabel: Story = {
  name: "With Label",
  render: () => (
    <div className="flex items-center gap-2">
      <Switch id="airplane-mode" />
      <Label htmlFor="airplane-mode">Airplane Mode</Label>
    </div>
  ),
};

export const AllSizes: Story = {
  name: "All Sizes",
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="type-mono-label w-20 text-muted-foreground/80">sm</span>
        <Switch size="sm" />
        <Switch size="sm" defaultChecked />
      </div>
      <div className="flex items-center gap-3">
        <span className="type-mono-label w-20 text-muted-foreground/80">default</span>
        <Switch size="default" />
        <Switch size="default" defaultChecked />
      </div>
    </div>
  ),
  parameters: { layout: "padded" },
};
