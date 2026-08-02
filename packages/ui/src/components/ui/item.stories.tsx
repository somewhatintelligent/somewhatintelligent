import type { Meta, StoryObj } from "@storybook/react";
import { Item, ItemContent, ItemTitle, ItemDescription, ItemGroup, ItemActions } from "./item";
import { Badge } from "./badge";
import { Button } from "./button";

const meta = {
  title: "UI/Item",
  component: Item,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof Item>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <ItemGroup className="w-96">
      <Item>
        <ItemContent>
          <ItemTitle>Elena Vasquez</ItemTitle>
          <ItemDescription>elena@example.com</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="success">Active</Badge>
        </ItemActions>
      </Item>
      <Item>
        <ItemContent>
          <ItemTitle>Marcus Chen</ItemTitle>
          <ItemDescription>marcus@example.com</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="default">Admin</Badge>
        </ItemActions>
      </Item>
      <Item>
        <ItemContent>
          <ItemTitle>Theo Andersson</ItemTitle>
          <ItemDescription>theo@example.com</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Badge variant="destructive">Banned</Badge>
          <Button variant="ghost" size="sm">
            Unban
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  ),
};

export const Outline: Story = {
  render: () => (
    <Item variant="outline" className="w-96">
      <ItemContent>
        <ItemTitle>Outlined Item</ItemTitle>
        <ItemDescription>With a visible border around it.</ItemDescription>
      </ItemContent>
    </Item>
  ),
};

export const Muted: Story = {
  render: () => (
    <Item variant="muted" className="w-96">
      <ItemContent>
        <ItemTitle>Muted Item</ItemTitle>
        <ItemDescription>With a subtle muted background.</ItemDescription>
      </ItemContent>
    </Item>
  ),
};
