import type { ReactNode } from "react";

import { brand, type LogoOgSurface } from "./brand.ts";
import { LogoIcon } from "./logo-icon.tsx";

/**
 * THE LOCKUP EVERY SOCIAL CARD IS BUILT FROM, and the reason it lives in the
 * design package rather than in one app's `og/` directory: the site and the
 * identity app both publish cards, and two copies of a wordmark lockup is two
 * chances for the brand to be one app-version out of date on a surface that
 * only ever shows up in someone else's feed.
 *
 * A SEPARATE ENTRY POINT — `platform.design/logo/og`, not `platform.design/logo`
 * — because this is build-time-only artwork and has no business in a client
 * bundle that only wanted the mark.
 *
 * INLINE STYLES AND LITERAL HEX. satori resolves neither Tailwind nor a CSS
 * custom property, so a card carries concrete values; they come from
 * `brand.ogSurfaces`, which exists for exactly this. And every element with two
 * or more children declares `display: flex`, because satori's layout engine is
 * yoga and yoga knows flex and nothing else.
 */
export function OgLockup({
  surface,
  markSize,
  wordmarkSize,
  eyebrow,
}: {
  surface: LogoOgSurface;
  markSize: number;
  wordmarkSize: number;
  /** The line under the wordmark. Omit for the wordmark alone. */
  eyebrow?: string;
}) {
  const eyebrowSize = Math.max(11, Math.round(wordmarkSize * 0.2));
  const tracking = 0.28 * eyebrowSize;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: Math.round(markSize * 0.34) }}>
        <LogoIcon colorScheme={surface.scheme} size={markSize} />
        <span
          style={{
            fontFamily: "Barlow Condensed",
            fontWeight: 700,
            fontSize: wordmarkSize,
            lineHeight: 1,
            letterSpacing: `${-0.015 * wordmarkSize}px`,
            color: surface.text,
          }}
        >
          {brand.wordmarkFull}
        </span>
      </div>
      {eyebrow ? (
        <span
          style={{
            marginTop: Math.round(eyebrowSize * 1.6),
            fontFamily: "Iosevka",
            fontSize: eyebrowSize,
            textTransform: "uppercase",
            letterSpacing: `${tracking}px`,
            /**
             * Letter-spacing is applied to the RIGHT of the last glyph too, so
             * a centred tracked line sits half a step left of where it looks
             * like it should. Half of it back, and the eyebrow is centred on
             * what a reader sees rather than on the box.
             */
            paddingLeft: `${tracking}px`,
            color: surface.muted,
          }}
        >
          {eyebrow}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A full-bleed card ground. Every definition opens with one, so the 1200×630
 * and the 32×32 agree about what the brand's ground is.
 */
export function OgCanvas({ surface, children }: { surface: LogoOgSurface; children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: surface.bg,
      }}
    >
      {children}
    </div>
  );
}
