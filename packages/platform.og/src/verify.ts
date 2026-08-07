import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverOgDefinitions, loadOgConfig } from "./discover.ts";
import { loadFonts } from "./fonts.ts";
import { renderOg } from "./render.ts";

export type OgCardCheck = {
  name: string;
  /** `1200x630` — what a consumer's `<meta>` tags and manifest have to agree with. */
  dimensions: string;
  /** Did the committed PNG match a fresh render? */
  current: boolean;
};

/**
 * RE-RENDERS EVERY DEFINITION AND COMPARES IT TO THE COMMITTED PNG.
 *
 * The pipeline writes build output into git, which is the right call for
 * artwork a crawler fetches once from a cold cache — and which buys exactly one
 * problem: the definition and the file can drift, and a stale card looks fine
 * until it is in someone's feed with last quarter's wordmark on it. `bun run og`
 * is a step a person has to remember. This is what remembers for them.
 *
 * It lives here rather than in each app because the assertion is identical
 * everywhere and the only difference is which test runner makes it — the two
 * consumers were carrying the same body, size table included, under two
 * imports.
 *
 * Possible at all because satori and resvg are deterministic; the CLI's
 * skip-unchanged path depends on the same property.
 */
export async function verifyOgCards(appRoot: string, outDir = "public/og"): Promise<OgCardCheck[]> {
  const entries = await discoverOgDefinitions(appRoot);
  const fonts = await loadFonts((await loadOgConfig(appRoot)).fonts ?? [], appRoot);
  const dest = resolve(appRoot, outDir);

  return Promise.all(
    entries.map(async ({ definition }): Promise<OgCardCheck> => {
      const rendered = await renderOg(await definition.render(), {
        size: definition.size,
        fonts,
      });
      let current = false;
      try {
        current = (await readFile(resolve(dest, `${definition.name}.png`))).equals(
          Buffer.from(rendered),
        );
      } catch {
        // Missing file — the tags point at a 404, which is the failure this
        // whole guard exists to catch. `current: false` says so.
      }
      return {
        name: definition.name,
        dimensions: `${definition.size.width}x${definition.size.height}`,
        current,
      };
    }),
  );
}
