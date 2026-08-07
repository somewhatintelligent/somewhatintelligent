import { Resvg } from "@resvg/resvg-js";
import type { ReactNode } from "react";
import satori from "satori";
import type { SatoriFont } from "./fonts.ts";

export type RenderOptions = {
  size: { width: number; height: number };
  /** Omit for a definition with no text nodes — satori needs no font in that case. */
  fonts?: readonly SatoriFont[];
};

/**
 * JSX → SVG (satori) → PNG (resvg).
 *
 * BUILD-TIME ONLY, and the second half is why: `@resvg/resvg-js` is a native
 * napi binding, so this module cannot be imported by a Worker. Generating a
 * card at request time on Cloudflare needs the wasm rasteriser instead
 * (`@resvg/resvg-wasm`, or `workers-og` around it) — a different dependency and
 * a different deployment story, deliberately not smuggled in here.
 */
export async function renderOg(element: ReactNode, options: RenderOptions): Promise<Uint8Array> {
  const svg = await satori(element, {
    width: options.size.width,
    height: options.size.height,
    fonts: [...(options.fonts ?? [])],
  });
  return new Resvg(svg).render().asPng();
}
