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
  /**
   * The `integ` suite runs under `bun test` via the `test:integ` script — it
   * deploys the stack through alchemy's `Test/Bun` harness and imports
   * `bun:test`, which Vitest cannot load. Collected, it fails at import with
   * `protocol 'bun:' not supported`: a red suite that says nothing about the
   * code.
   *
   * THE ROOT'S PATTERNS ARE RESTATED, not added to. `exclude` REPLACES rather
   * than merges, so a project-level list naming only the new pattern silently
   * drops the `.git` and worktree entries the root config carries. The root
   * config excludes the same directory for runs launched from there.
   */
  test: {
    includeTaskLocation: true,
    globals: true,
    exclude: ["**/node_modules/**", "**/.git/**", "**/integ/**", "**/worktrees/**"],
  },
});
