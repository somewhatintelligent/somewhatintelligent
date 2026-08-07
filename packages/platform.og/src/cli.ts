#!/usr/bin/env bun
/**
 * `platform-og build` — every `og/*.og.tsx` in the calling package, rendered to
 * a PNG in `public/og/`.
 *
 * THE OUTPUT IS COMMITTED, which is what makes this a build step and not a
 * route. A social crawler fetches a card once, from a cold cache, with a short
 * timeout and no cookies; the cheapest correct answer to that is a static file
 * the CDN already holds. Re-rendering per request would buy nothing and cost a
 * cold start on the one request that cannot afford one.
 *
 * Consequence worth stating: the images are only as fresh as the last build.
 * That is right for BRAND cards, whose inputs are the wordmark and the palette,
 * and wrong for anything keyed on live data — a product's card is its own
 * photograph, served from media, and never comes through here.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { OgDefinition } from "./define.ts";
import { DEFAULT_OG_GLOB, discoverOgDefinitions, loadOgConfig } from "./discover.ts";
import { loadFonts } from "./fonts.ts";
import { renderOg } from "./render.ts";

const USAGE =
  "usage: platform-og build [--cwd <dir>] [--out <dir>] [--glob <pattern>] [--config <path>]";

async function build(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      cwd: { type: "string" },
      out: { type: "string" },
      glob: { type: "string" },
      config: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  const cwd = resolve(values.cwd ?? process.cwd());
  const outDir = resolve(cwd, values.out ?? "public/og");
  const pattern = values.glob ?? DEFAULT_OG_GLOB;

  const entries = await discoverOgDefinitions(cwd, pattern);
  if (entries.length === 0) {
    console.error(`platform-og: no files matched ${pattern} in ${cwd}`);
    process.exit(1);
  }

  const config = await loadOgConfig(cwd, values.config);
  const fonts = await loadFonts(config.fonts ?? [], cwd);

  await mkdir(outDir, { recursive: true });

  const started = performance.now();
  let written = 0;

  /**
   * ONE RASTER PER ARTWORK, NOT PER NAME.
   *
   * `twitter.og.tsx` is `{ ...opengraph, name: "twitter-image" }` — the same
   * element function under a second filename, because `twitter:image` is a
   * separate tag and should survive `og:image` changing. Rendering it a second
   * time produced a byte-identical 1200×630 PNG, which was roughly half the
   * raster cost of every build and every drift test.
   *
   * Keyed on the `render` FUNCTION IDENTITY and the size, which is exactly the
   * spread-from-another-definition case and nothing looser. Two definitions
   * that merely happen to draw the same thing still render twice — this dedupes
   * a shared artwork, not a coincidence.
   */
  const rasters = new Map<OgDefinition["render"], { dimensions: string; png: Uint8Array }>();

  for (const { file, definition } of entries) {
    const dimensions = `${definition.size.width}×${definition.size.height}`;

    const cached = rasters.get(definition.render);
    let png = cached?.dimensions === dimensions ? cached.png : undefined;

    if (!png) {
      try {
        png = await renderOg(await definition.render(), { size: definition.size, fonts });
      } catch (cause) {
        // The file, not the stack frame inside yoga. Which definition failed is
        // the one thing the thrown error never says.
        console.error(`  ✗ ${file}`);
        throw cause;
      }
      rasters.set(definition.render, { dimensions, png });
    }

    const dest = resolve(outDir, `${definition.name}.png`);

    /**
     * IDENTICAL BYTES ARE NOT REWRITTEN. satori and resvg are deterministic, so
     * a rebuild after an unrelated change produces the same file — and touching
     * it anyway would show up as a binary diff in every review and invalidate
     * the task cache of everything downstream.
     */
    if (await unchanged(dest, png)) {
      console.log(`  · ${definition.name}.png  ${dimensions}  (unchanged)`);
      continue;
    }

    await writeFile(dest, png);
    written += 1;
    console.log(`  ✓ ${definition.name}.png  ${dimensions}`);
  }

  const ms = Math.round(performance.now() - started);
  console.log(
    `platform-og: ${entries.length} definition(s), ${written} written into ${outDir} in ${ms}ms`,
  );
}

async function unchanged(dest: string, next: Uint8Array): Promise<boolean> {
  try {
    /** Native memcmp, rather than a JS callback per byte across ~90 KB of PNG. */
    return (await readFile(dest)).equals(Buffer.from(next));
  } catch {
    // No file yet — every byte is a change.
    return false;
  }
}

const [, , command, ...rest] = process.argv;

if (command === "build" || command === undefined) {
  await build(rest);
} else {
  console.error(`platform-og: unknown command "${command}"`);
  console.error(USAGE);
  process.exit(1);
}
