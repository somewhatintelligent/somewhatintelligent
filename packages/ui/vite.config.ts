import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

// templates/ui ships no dev server of its own — this config exists purely to
// give the shared component library a test runner: a plain-node "unit"
// project for pure-logic `*.test.ts`, plus a jsdom + @testing-library "dom"
// project for the `*.dom.test.tsx` component tier. Naming keeps the two
// runners from ever colliding. Tests colocate in `src/**/__tests__/` next to
// the component they cover, matching packages/kit's convention. `extends:
// true` inherits this root config (globals + the react plugin) so neither
// project has to restate it.
export default defineConfig({
  plugins: [react()],
  lint: {
    ignorePatterns: ["**/__tests__/**/*"],
  },
  test: {
    includeTaskLocation: true,
    globals: true,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/__tests__/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "dom",
          include: ["src/**/__tests__/*.dom.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./__tests__/setup-dom.ts"],
        },
      },
    ],
  },
});
