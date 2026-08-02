import type { Meta, StoryObj } from "@storybook/react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer";
import { Button } from "./button";

const meta = {
  title: "UI/Drawer",
  component: Drawer,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bottom: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Open Drawer</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Adjust Settings</DrawerTitle>
          <DrawerDescription>
            Drawers use the glass overlay and slide up from the bottom by default.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 text-sm text-muted-foreground">
          <p>Swipe down or tap the overlay to dismiss.</p>
        </div>
        <DrawerFooter>
          <Button>Save</Button>
          <DrawerClose asChild>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
};

export const FromRight: Story = {
  render: () => (
    <Drawer direction="right">
      <DrawerTrigger asChild>
        <Button variant="outline">Open Right Drawer</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Details Panel</DrawerTitle>
          <DrawerDescription>
            A right-side drawer is useful for detail views and sidebars.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-2 px-4">
          <Button variant="ghost" className="justify-start">
            Profile
          </Button>
          <Button variant="ghost" className="justify-start">
            Preferences
          </Button>
          <Button variant="ghost" className="justify-start">
            Sign Out
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  ),
};

export const WithActions: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="destructive">Delete Item</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Confirm Deletion</DrawerTitle>
          <DrawerDescription>
            This action cannot be undone. The item will be permanently removed.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button variant="destructive">Delete</Button>
          <DrawerClose asChild>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
};
