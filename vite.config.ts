import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": ["vp check --fix"],
    /**
     * `audit` rather than `dead-code`: it reviews only the CHANGED files, so a
     * commit is gated on what it INTRODUCED rather than on the repo's whole
     * standing backlog. It exits non-zero on a fail verdict already.
     *
     * `sh -c ... --` so the staged filenames land as ignored positional args:
     * `audit` derives the changed set from git itself and rejects paths, so
     * passed them directly it fails on its own arguments rather than the code.
     *
     * `FALLOW_AUDIT_BASE` because the base is otherwise the merge-base against
     * an upstream and `trunk` has none — unset, the hook errors out instead of
     * gating, which reads as passing.
     */
    "**/*.{ts,tsx}": ["sh -c 'FALLOW_AUDIT_BASE=HEAD bunx fallow audit' --"],
  },
  fmt: {
    ignorePatterns: [
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
