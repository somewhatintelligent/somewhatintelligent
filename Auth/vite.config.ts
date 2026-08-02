import path from "node:path";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "#": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: { ssrEmitAssets: false },
  plugins: [tanstackStart({ router: { addExtensions: true } }), react(), tailwindcss()],
  test: { includeTaskLocation: true, globals: true },
});
