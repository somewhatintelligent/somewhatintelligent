import type { Meta, StoryObj } from "@storybook/react";

/**
 * Pure token specimens — no UI component imports.
 * These show the raw shadow/material CSS tokens.
 * For component variants, see the Card and Button stories in @si/ui.
 */
function ShadowsPage() {
  const shadows = [
    {
      name: "brutal-sm",
      css: "var(--brutal-sm)",
      material: "rounded-sm border-2 border-border-strong bg-surface-raised",
    },
    {
      name: "brutal-md",
      css: "var(--brutal-md)",
      material: "rounded-sm border-2 border-border-strong bg-surface-raised",
    },
    {
      name: "brutal-lg",
      css: "var(--brutal-lg)",
      material: "rounded-sm ring-1 ring-foreground bg-card",
    },
    {
      name: "soft-sm",
      css: "var(--soft-sm)",
      material: "rounded-sm border border-border bg-surface-raised",
    },
    {
      name: "soft-md",
      css: "var(--soft-md)",
      material: "rounded-sm border border-border bg-surface-raised",
    },
    {
      name: "soft-lg",
      css: "var(--soft-lg)",
      material: "rounded-sm border border-border bg-surface-raised",
    },
    { name: "neo-raised", css: "var(--neo-raised)", material: "rounded-sm border-none bg-surface" },
    { name: "neo-inset", css: "var(--neo-inset)", material: "rounded-sm border-none bg-surface" },
    { name: "glass", css: "var(--glass-shadow)", material: "rounded-sm glass" },
  ];

  return (
    <div className="max-w-4xl space-y-12 p-8">
      <div>
        <h2 className="mb-2 font-heading text-2xl">Shadows</h2>
        <p className="text-sm text-muted-foreground">
          Three shadow families (Brutal, Soft, Neumorphic) plus Glass. Each specimen uses the same
          border/background treatment as the real components that use that shadow.
        </p>
      </div>

      {/* Shadow specimens — grouped by family */}
      {[
        { label: "Brutal", keys: ["brutal-sm", "brutal-md", "brutal-lg"] },
        { label: "Soft", keys: ["soft-sm", "soft-md", "soft-lg"] },
        { label: "Neumorphic", keys: ["neo-raised", "neo-inset"] },
        { label: "Glass", keys: ["glass"] },
      ].map((group) => (
        <section key={group.label} className="space-y-4">
          <h3 className="type-section-label text-muted-foreground">{group.label}</h3>
          <div className="grid grid-cols-3 gap-6">
            {shadows
              .filter((s) => group.keys.includes(s.name))
              .map((s) => (
                <div
                  key={s.name}
                  className={`${s.material} p-6 text-center`}
                  style={{ boxShadow: s.css }}
                >
                  <span className="type-mono-label text-muted-foreground">{s.name}</span>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const meta: Meta = {
  title: "Design/Shadows",
  tags: ["autodocs"],
};
export default meta;

export const AllShadows: StoryObj = {
  render: () => <ShadowsPage />,
  parameters: { layout: "fullscreen" },
};
