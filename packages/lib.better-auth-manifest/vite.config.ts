import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { includeTaskLocation: true, globals: true },
});
