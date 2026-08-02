import type { Meta, StoryObj } from "@storybook/react";

function GlassPage() {
  return (
    <div className="max-w-4xl space-y-12 p-8">
      <div>
        <h2 className="mb-2 font-heading text-2xl">Glass Effects</h2>
        <p className="text-sm text-muted-foreground">
          Glassmorphism using the glass-bg, glass-border, and glass-blur tokens.
        </p>
      </div>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Over Gradient</h3>
        <div className="relative h-64 overflow-hidden rounded-sm bg-gradient-to-br from-primary/40 via-destructive/20 to-success/30 p-8">
          <div className="absolute inset-8 flex flex-col justify-between rounded-sm glass p-6">
            <div>
              <h4 className="text-lg font-semibold">Glass Card</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Translucent surface with blur backdrop.
              </p>
            </div>
            <div className="flex gap-2 font-mono text-xs text-muted-foreground">
              <span className="rounded bg-surface-sunken px-2 py-0.5">--glass-bg</span>
              <span className="rounded bg-surface-sunken px-2 py-0.5">--glass-border</span>
              <span className="rounded bg-surface-sunken px-2 py-0.5">--glass-blur: 24px</span>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Stacked Cards</h3>
        <div className="relative h-72 overflow-hidden rounded-sm bg-gradient-to-tr from-warning/30 via-primary/20 to-muted/30 p-8">
          <div className="absolute top-8 left-8 h-40 w-56 rounded-sm glass p-4">
            <p className="font-semibold">Layer 1</p>
            <p className="text-sm text-muted-foreground">Background glass</p>
          </div>
          <div className="absolute top-16 left-20 h-40 w-56 rounded-sm glass p-4">
            <p className="font-semibold">Layer 2</p>
            <p className="text-sm text-muted-foreground">Foreground glass</p>
          </div>
        </div>
      </section>
    </div>
  );
}

const meta: Meta = {
  title: "Design/Glass Effects",
  tags: ["autodocs"],
};
export default meta;

export const GlassEffects: StoryObj = {
  render: () => <GlassPage />,
  parameters: { layout: "fullscreen" },
};
