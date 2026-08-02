import path from "node:path";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./app"),
      "#": path.resolve(import.meta.dirname, "./app"),
    },
  },
  build: { ssrEmitAssets: false },
  plugins: [
    // `app`, not the default `src`: routes, the route tree, and the start /
    // router / server entries are all resolved relative to this one setting,
    // which is what lets the client live beside `api/` rather than under it.
    tanstackStart({ srcDirectory: "app", router: { addExtensions: true } }),
    react(),
    tailwindcss(),
  ],
  test: { includeTaskLocation: true, globals: true },
});
