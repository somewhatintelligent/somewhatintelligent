import type { Meta, StoryObj } from "@storybook/react";
import { Alert, AlertTitle, AlertDescription } from "./alert";

const meta = {
  title: "UI/Alert",
  component: Alert,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "destructive", "primary", "success", "warning"],
    },
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Alert {...args} className="w-96">
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>You can add components to your app using the CLI.</AlertDescription>
    </Alert>
  ),
};

export const Destructive: Story = {
  args: { variant: "destructive" },
  render: (args) => (
    <Alert {...args} className="w-96">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>Your session has expired. Please sign in again.</AlertDescription>
    </Alert>
  ),
};

export const Glyph: Story = {
  args: { variant: "primary" },
  render: (args) => (
    <Alert {...args} className="w-96">
      <AlertTitle>Info</AlertTitle>
      <AlertDescription>A new version of the design system is available.</AlertDescription>
    </Alert>
  ),
};

export const Verdigris: Story = {
  args: { variant: "success" },
  render: (args) => (
    <Alert {...args} className="w-96">
      <AlertTitle>Success</AlertTitle>
      <AlertDescription>Your changes have been saved.</AlertDescription>
    </Alert>
  ),
};

export const Ochre: Story = {
  args: { variant: "warning" },
  render: (args) => (
    <Alert {...args} className="w-96">
      <AlertTitle>Warning</AlertTitle>
      <AlertDescription>Your API key expires in 3 days.</AlertDescription>
    </Alert>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      <Alert variant="default">
        <AlertTitle>Default</AlertTitle>
        <AlertDescription>Brutalist border, neutral surface.</AlertDescription>
      </Alert>
      <Alert variant="primary">
        <AlertTitle>Info</AlertTitle>
        <AlertDescription>Primary accent — informational.</AlertDescription>
      </Alert>
      <Alert variant="success">
        <AlertTitle>Success</AlertTitle>
        <AlertDescription>Verdigris — confirmation.</AlertDescription>
      </Alert>
      <Alert variant="warning">
        <AlertTitle>Warning</AlertTitle>
        <AlertDescription>Ochre — attention needed.</AlertDescription>
      </Alert>
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Blood — something went wrong.</AlertDescription>
      </Alert>
    </div>
  ),
  parameters: { layout: "padded" },
};
