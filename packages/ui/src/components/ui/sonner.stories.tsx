import type { Meta, StoryObj } from "@storybook/react";
import { toast } from "sonner";
import { Toaster } from "./sonner";
import { Button } from "./button";

const meta = {
  title: "UI/Sonner",
  component: Toaster,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="flex min-h-48 flex-col items-start gap-3 p-4">
        <Story />
        <Toaster />
      </div>
    ),
  ],
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <Button onClick={() => toast("Event has been created.")}>Show Toast</Button>,
};

export const Success: Story = {
  render: () => (
    <Button variant="success" onClick={() => toast.success("Changes saved successfully.")}>
      Show Success
    </Button>
  ),
};

export const Error: Story = {
  render: () => (
    <Button
      variant="destructive"
      onClick={() =>
        toast.error("Something went wrong.", { description: "Please try again later." })
      }
    >
      Show Error
    </Button>
  ),
};

export const Warning: Story = {
  render: () => (
    <Button variant="outline" onClick={() => toast.warning("This action cannot be undone.")}>
      Show Warning
    </Button>
  ),
};

export const WithDescription: Story = {
  render: () => (
    <Button
      onClick={() =>
        toast("Meeting scheduled", {
          description: "Friday, April 11 at 2:00 PM",
        })
      }
    >
      With Description
    </Button>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast("Default notification")}>Default</Button>
      <Button variant="success" onClick={() => toast.success("Operation succeeded")}>
        Success
      </Button>
      <Button variant="destructive" onClick={() => toast.error("Operation failed")}>
        Error
      </Button>
      <Button variant="outline" onClick={() => toast.warning("Proceed with caution")}>
        Warning
      </Button>
    </div>
  ),
};
