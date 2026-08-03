import path from "node:path";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

/**
 * The operator console's build, and nothing else in this package.
 *
 * `srcDirectory: "app"` is what keeps the console out of the substrate's way:
 * routes, the route tree, and the start / router / server entries all resolve
 * relative to that one setting, so the client lives beside `domain/` and
 * `workers/` rather than under them. The Workers themselves are bundled by
 * alchemy from `workers/*.ts` and never pass through Vite.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./app"),
    },
  },
  build: { ssrEmitAssets: false },
  plugins: [
    tanstackStart({ srcDirectory: "app", router: { addExtensions: true } }),
    react(),
    tailwindcss(),
  ],
  test: { includeTaskLocation: true, globals: true },
});
