import type { Meta, StoryObj } from "@storybook/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "./card";
import { Button } from "./button";

const meta = {
  title: "UI/Card",
  component: Card,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "soft", "neo", "glass"],
    },
    size: {
      control: "select",
      options: ["default", "sm"],
    },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description with supporting text.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Card content goes here. This is where the main information lives.</p>
      </CardContent>
      <CardFooter>
        <Button size="sm">Action</Button>
      </CardFooter>
    </Card>
  ),
};

export const Soft: Story = {
  args: { variant: "soft" },
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Soft</CardTitle>
        <CardDescription>Gentle elevation. Secondary content.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Diffused shadows for less prominent surfaces.</p>
      </CardContent>
    </Card>
  ),
};

export const Neumorphic: Story = {
  args: { variant: "neo" },
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>Neumorphic</CardTitle>
        <CardDescription>Carved depth. Interactive elements.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Raised and inset shadows carved from the surface.</p>
      </CardContent>
    </Card>
  ),
};

export const Glass: Story = {
  args: { variant: "glass" },
  render: (args) => (
    <div className="relative h-64 w-96 overflow-hidden rounded-sm bg-gradient-to-br from-primary/30 via-destructive/20 to-success/30 p-8">
      <Card {...args} className="h-full">
        <CardHeader>
          <CardTitle>Glass</CardTitle>
          <CardDescription>Frosted blur. Over images only.</CardDescription>
        </CardHeader>
        <CardContent>
          <p>Glassmorphism using glass tokens.</p>
        </CardContent>
      </Card>
    </div>
  ),
};

/** All four card styles side by side, matching the design demo */
export const DesignDemoShowcase: Story = {
  name: "Design Demo Showcase",
  render: () => (
    <div className="grid max-w-3xl grid-cols-2 gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Brutalist</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">4px border, hard shadow. The signature.</p>
        </CardContent>
      </Card>
      <Card variant="soft">
        <CardHeader>
          <CardTitle>Soft</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Gentle elevation. Secondary content.</p>
        </CardContent>
      </Card>
      <Card variant="neo">
        <CardHeader>
          <CardTitle>Neumorphic</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Carved depth. Interactive elements.</p>
        </CardContent>
      </Card>
      <Card variant="glass">
        <CardHeader>
          <CardTitle>Glass</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Frosted blur. Over images only.</p>
        </CardContent>
      </Card>
    </div>
  ),
  parameters: { layout: "padded" },
};

export const Small: Story = {
  args: { size: "sm" },
  render: (args) => (
    <Card {...args} className="w-72">
      <CardHeader>
        <CardTitle>Compact Card</CardTitle>
        <CardDescription>Smaller variant for tight spaces.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Reduced padding and gap for dense layouts.</p>
      </CardContent>
    </Card>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <Card {...args} className="w-80">
      <CardHeader>
        <CardTitle>With Action</CardTitle>
        <CardDescription>A card with a header action.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm">
            ...
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p>The action button sits in the top-right corner of the header.</p>
      </CardContent>
    </Card>
  ),
};

export const AllVariants: Story = {
  render: () => {
    const variants = ["default", "soft", "neo", "glass"] as const;
    const sizes = ["default", "sm"] as const;
    const descriptions: Record<string, string> = {
      default: "4px border, hard shadow. The signature.",
      soft: "Gentle elevation. Secondary content.",
      neo: "Carved depth. Interactive elements.",
      glass: "Frosted blur. Over images only.",
    };

    return (
      <div className="flex flex-col gap-8">
        <div className="flex items-end gap-4">
          <span className="type-mono-label w-20 text-muted-foreground/80" />
          {sizes.map((size) => (
            <span key={size} className="type-mono-label w-72 text-muted-foreground/80">
              {size}
            </span>
          ))}
        </div>
        {variants.map((variant) => (
          <div key={variant} className="flex items-start gap-4">
            <span className="type-mono-label w-20 pt-4 text-muted-foreground/80">{variant}</span>
            {sizes.map((size) => (
              <Card key={`${variant}-${size}`} variant={variant} size={size} className="w-72">
                <CardHeader>
                  <CardTitle>{variant.charAt(0).toUpperCase() + variant.slice(1)}</CardTitle>
                  <CardDescription>{descriptions[variant]}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">size: {size}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        ))}
      </div>
    );
  },
  parameters: { layout: "padded" },
};
