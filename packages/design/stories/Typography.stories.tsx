import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "Design/Typography",
  tags: ["autodocs"],
};
export default meta;

/** Hero type moment + Barlow Condensed weight specimens */
export const Display: StoryObj = {
  name: "Display — Barlow Condensed",
  render: () => (
    <div className="max-w-5xl space-y-12 p-8">
      <div>
        <h3 className="mb-1 type-section-label text-muted-foreground">
          Display — Barlow Condensed
        </h3>
        <p className="mb-8 font-mono text-xs text-muted-foreground">
          Headlines, releases, public claims · condensed · use big, dense, and deliberately
        </p>
      </div>

      {/* Hero type moment */}
      <div className="border-b-4 border-border-strong pb-12">
        <div
          className="font-display leading-[0.95] tracking-[0.005em]"
          style={{ fontSize: "clamp(80px, 14vw, 200px)", fontWeight: 400 }}
        >
          somewhat
        </div>
        <div
          className="font-display leading-[0.95] tracking-[0.005em] text-muted-foreground"
          style={{ fontSize: "clamp(80px, 14vw, 200px)", fontWeight: 700 }}
        >
          intelligent
        </div>
      </div>

      {/* Weight specimens */}
      <div className="space-y-0 overflow-hidden font-display">
        <div
          style={{
            fontSize: "clamp(60px, 10vw, 160px)",
            fontWeight: 200,
            lineHeight: 0.92,
            letterSpacing: "-0.02em",
          }}
        >
          Extralight
        </div>
        <div
          style={{
            fontSize: "clamp(60px, 10vw, 160px)",
            fontWeight: 300,
            lineHeight: 0.92,
            letterSpacing: "-0.02em",
          }}
        >
          Light
        </div>
        <div
          style={{
            fontSize: "clamp(60px, 10vw, 160px)",
            fontWeight: 400,
            lineHeight: 0.92,
            letterSpacing: "-0.02em",
          }}
        >
          Regular
        </div>
        <div style={{ fontSize: "clamp(48px, 8vw, 120px)", fontWeight: 700, lineHeight: 0.95 }}>
          Bold
        </div>
        <div style={{ fontSize: "clamp(48px, 8vw, 120px)", fontWeight: 900, lineHeight: 0.95 }}>
          Black
        </div>
      </div>

      {/* Accent lockup */}
      <div>
        <div
          className="font-accent italic text-primary"
          style={{
            fontSize: "clamp(48px, 8vw, 120px)",
            fontWeight: 400,
            lineHeight: 0.95,
            letterSpacing: "0.005em",
          }}
        >
          learn green
        </div>
        <div
          className="font-display"
          style={{
            fontSize: "clamp(48px, 8vw, 120px)",
            fontWeight: 400,
            lineHeight: 0.95,
            letterSpacing: "0.005em",
          }}
        >
          earn green
        </div>
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};

/** Source Serif 4 — the default body/UI font */
export const Body: StoryObj = {
  name: "Body — Source Serif 4",
  render: () => (
    <div className="max-w-4xl space-y-8 p-8">
      <div>
        <h3 className="mb-1 type-section-label text-muted-foreground">Body — Source Serif 4</h3>
        <p className="mb-6 font-mono text-xs text-muted-foreground">
          THE DEFAULT · UI, labels, buttons, nav, descriptions · 14–18px · weight 400–700
        </p>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div>
          <p className="mb-2 type-mono-label text-muted-foreground">16px / 400</p>
          <p className="text-base leading-relaxed text-muted-foreground">
            Drawn, not decorated. Cold paper, black cotton, and steel rules make the interface a
            publishing surface rather than a themed dashboard.
          </p>
        </div>
        <div>
          <p className="text-base">
            <span className="font-normal">Regular</span> ·{" "}
            <span className="font-medium">Medium</span> ·{" "}
            <span className="font-semibold">Semibold</span> ·{" "}
            <span className="font-bold">Bold</span> · <span className="italic">Italic</span>
          </p>
          <p className="mt-3 rounded bg-surface-sunken px-2 py-1 font-mono text-[11px] text-muted-foreground">
            BOLD: labels, emphasis · ITALIC: inline prose only · 600+ for buttons
          </p>
        </div>
      </div>

      {/* Size ramp */}
      <div className="space-y-3 border-t border-border pt-8">
        <p className="mb-4 type-mono-label text-muted-foreground">Size ramp</p>
        {[12, 14, 16, 18, 20].map((size) => (
          <div key={size} className="flex items-baseline gap-4">
            <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{size}px</span>
            <p style={{ fontSize: size }}>The quick brown fox jumps over the lazy dog</p>
          </div>
        ))}
      </div>

      {/* Weight ramp */}
      <div className="space-y-3 border-t border-border pt-8">
        <p className="mb-4 type-mono-label text-muted-foreground">Weight ramp</p>
        {[
          { weight: 300, label: "Light" },
          { weight: 400, label: "Regular" },
          { weight: 500, label: "Medium" },
          { weight: 600, label: "SemiBold" },
          { weight: 700, label: "Bold" },
        ].map(({ weight, label }) => (
          <div key={weight} className="flex items-baseline gap-4">
            <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{weight}</span>
            <p className="text-lg" style={{ fontWeight: weight }}>
              {label} — The quick brown fox jumps over the lazy dog
            </p>
          </div>
        ))}
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};

/** Source Serif 4 — editorial serif for long-form prose */
export const Editorial: StoryObj = {
  name: "Editorial — Source Serif 4",
  render: () => (
    <div className="max-w-4xl space-y-8 p-8">
      <div>
        <h3 className="mb-1 type-section-label text-muted-foreground">
          Editorial — Source Serif 4
        </h3>
        <p className="mb-6 font-mono text-xs text-muted-foreground">
          Long-form prose, articles, pull quotes · 18–22px · light weight
        </p>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div>
          <p className="mb-2 type-mono-label text-muted-foreground">18px / 300 — Article body</p>
          <p className="font-editorial text-lg leading-[1.75] text-muted-foreground">
            Ruled structure with nearly square corners, neutral surfaces, and one scarce signal. The
            material speaks before the ornament does.
          </p>
        </div>
        <div>
          <p className="mb-2 type-mono-label text-muted-foreground">
            24px / 300 italic — Pull quote
          </p>
          <p className="font-editorial-display text-2xl font-light italic leading-snug text-primary">
            "Rooted in nature. Designed for connection. Learn green, earn green."
          </p>
        </div>
      </div>

      {/* Paragraph specimen */}
      <div className="border-t border-border pt-8">
        <p className="mb-2 type-mono-label text-muted-foreground">Paragraph specimen</p>
        <div className="max-w-2xl font-editorial text-lg leading-[1.75]">
          <p className="mb-6">
            There is a particular quality to things built with intention. Not the frantic minimalism
            of startups that strip everything away until nothing remains, but the measured restraint
            of a craftsman who knows exactly which details matter.
          </p>
          <p>
            Digital interfaces deserve the same consideration. Every border weight, every shadow
            offset, every typeface pairing is a choice that communicates something. The question is
            whether you're making that choice <em>deliberately</em> or by default.
          </p>
        </div>
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};

/** Iosevka — monospace for code, data, timestamps */
export const Mono: StoryObj = {
  name: "Mono — Iosevka",
  render: () => (
    <div className="max-w-4xl space-y-8 p-8">
      <div>
        <h3 className="mb-1 type-section-label text-muted-foreground">Mono — Iosevka</h3>
        <p className="mb-6 font-mono text-xs text-muted-foreground">
          Code, data, timestamps, IDs, paths, keys
        </p>
      </div>

      {/* Code block */}
      <div className="overflow-x-auto rounded border-2 border-border bg-surface-sunken p-5 font-mono text-sm leading-relaxed">
        <span className="text-muted-foreground">const</span> tokens = {"{"} background:{" "}
        <span className="text-primary">"neutral-50"</span>,{" "}
        <span className="text-muted-foreground">{"// hsl(0 0% 98%)"}</span> foreground:{" "}
        <span className="text-primary">"neutral-950"</span>,{" "}
        <span className="text-muted-foreground">{"// hsl(0 0% 9%)"}</span> primary:{" "}
        <span className="text-primary">"accent-600"</span>,{" "}
        <span className="text-muted-foreground">{"// brand slot"}</span> {"}"};
      </div>

      {/* Weight ramp */}
      <div className="space-y-3 border-t border-border pt-8">
        <p className="mb-4 type-mono-label text-muted-foreground">Weight ramp</p>
        {[
          { weight: 300, label: "Light" },
          { weight: 400, label: "Regular" },
          { weight: 700, label: "Bold" },
        ].map(({ weight, label }) => (
          <div key={weight} className="flex items-baseline gap-4">
            <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{weight}</span>
            <p className="font-mono text-base" style={{ fontWeight: weight }}>
              {label} — 0123456789 ABCDEF abcdef {"{}[]();<>"}
            </p>
          </div>
        ))}
      </div>

      {/* Data specimen */}
      <div className="border-t border-border pt-8">
        <p className="mb-4 type-mono-label text-muted-foreground">Data specimen</p>
        <div className="space-y-1 font-mono text-sm text-muted-foreground">
          <p>
            user_id: <span className="text-primary">usr_01HZ3KPXV7BNWQ</span>
          </p>
          <p>
            session: <span className="text-primary">sess_9f4a2c8b-e1d7</span>
          </p>
          <p>
            created: <span className="text-muted-foreground">2026-04-05T14:32:00Z</span>
          </p>
          <p>
            path: <span className="text-muted-foreground">/api/v1/oauth/authorize</span>
          </p>
        </div>
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};

/** prose-platform utility — editorial content styling */
export const ProsePlatform: StoryObj = {
  name: "prose-platform",
  render: () => (
    <div className="max-w-3xl p-8">
      <div className="mb-8">
        <h3 className="mb-1 type-section-label text-muted-foreground">prose-platform</h3>
        <p className="font-mono text-xs text-muted-foreground">
          Editorial prose styling for long-form content
        </p>
      </div>

      <div className="prose prose-platform max-w-none">
        <h1>Rooted in Nature</h1>
        <p>
          On a neutral canvas, the system is drawn — ruled lines against legible text. Every mark is
          set with intention, generated from a single semantic token contract.
        </p>
        <h2>Consistent, Not Coincidental</h2>
        <p>
          Every token pairs <strong>a semantic name</strong> with{" "}
          <a href="#">a contrast-audited value</a> for both light and dark mode. The result is a
          system that reads the same way regardless of which brand palette sits underneath it.
        </p>
        <blockquote>
          The best interfaces feel inevitable: calm, legible, and quietly consistent.
        </blockquote>
        <h2>Where Structure Meets Legibility</h2>
        <p>
          Generous radii taught us something important: softness invites people in. The most durable
          systems happen when hard-edged structure meets rounded corners — when a friendly, rounded
          headline sits above prose that breathes and flows like natural speech.
        </p>
        <h3>Code Fragment</h3>
        <pre>
          <code>{`const tokens = {
  primary: "hsl(221 83% 53%)",
  destructive: "hsl(0 72% 47%)",
  background: "hsl(0 0% 98%)",
};`}</code>
        </pre>
        <p>
          When you walk past a garden catching the afternoon sun, you don't think about the soil it
          grew in. You feel the warmth. That's what good design does — it disappears into the
          experience, leaving only the feeling behind.
        </p>
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};
