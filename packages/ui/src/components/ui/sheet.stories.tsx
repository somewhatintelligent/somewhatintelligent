import type { Meta, StoryObj } from "@storybook/react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";
import { Button } from "./button";

const meta = {
  title: "UI/Sheet",
  component: Sheet,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Right: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>Open Right</SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Sheet from Right</SheetTitle>
          <SheetDescription>
            Sheets slide in from the edge of the viewport using the glass overlay style.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 text-sm text-muted-foreground">
          <p>Place settings panels, detail views, or forms inside a sheet.</p>
        </div>
        <SheetFooter>
          <Button>Save</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};

export const Left: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>Open Left</SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>A left-side sheet works well for navigation drawers.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4">
          <Button variant="ghost" className="justify-start">
            Dashboard
          </Button>
          <Button variant="ghost" className="justify-start">
            Settings
          </Button>
          <Button variant="ghost" className="justify-start">
            Account
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  ),
};

export const Top: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>Open Top</SheetTrigger>
      <SheetContent side="top">
        <SheetHeader>
          <SheetTitle>Announcement</SheetTitle>
          <SheetDescription>
            Top sheets are useful for banners or notification panels.
          </SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
};

export const Bottom: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>Open Bottom</SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Bottom Panel</SheetTitle>
          <SheetDescription>
            Bottom sheets behave like action sheets on mobile devices.
          </SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <Button>Confirm</Button>
          <Button variant="outline">Cancel</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
};
