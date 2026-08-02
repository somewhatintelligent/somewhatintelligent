import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

/**
 * Builds the web shell and nothing else. `src/server` and `src/core` are the
 * Worker, bundled by alchemy at deploy time from `src/server/entry.ts`.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/shell",
    emptyOutDir: true,
  },

  fmt: {
    ignorePatterns: ["**/dist/**", "**/design/**", "**/.alchemy/**"],
  },

  lint: {
    ignorePatterns: ["**/dist/**", "**/design/**", "**/.alchemy/**"],
    options: { typeAware: true, typeCheck: true },
  },

  run: {
    cache: true,
  },
});
