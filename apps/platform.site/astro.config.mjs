// @ts-check
import { defineConfig } from "astro/config";

/**
 * App concerns only.
 *
 * `lib.astro-alchemy` loads this file through astro's Node API and layers the
 * Cloudflare adapter on top with options derived from the stack — so no
 * `adapter`, no `output`, no `outDir`, no `configPath` here. Those live in
 * `module.ts`. Empty today because the home page needs no integrations; it is
 * the seam an integration lands in, not a placeholder.
 */
export default defineConfig({});
