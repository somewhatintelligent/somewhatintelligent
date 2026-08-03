// @ts-check
import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";

// App concerns only. Alchemy loads this file through astro's Node API
// (`configFile`) and layers the Cloudflare adapter on top, with options
// derived from the stack — the same relationship Website.Vite has with
// vite.config. Nothing Cloudflare-facing is authored here: no adapter,
// no output mode, no configPath.
export default defineConfig({
  integrations: [svelte()],
});
