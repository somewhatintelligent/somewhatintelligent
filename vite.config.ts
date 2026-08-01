import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": ["vp check --fix"],
  },
  fmt: {
    ignorePatterns: [
      "chemistry/**",
      "**/dist/**",
      "**/design/**",
      "**/.alchemy/**",
      "**/*.gen.ts",
      "**/migrations/**",
    ],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    ignorePatterns: [
      "chemistry/**",
      "**/dist/**",
      "**/design/**",
      "**/.alchemy/**",
      "**/*.gen.ts",
      "**/migrations/**",
    ],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
