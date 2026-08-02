import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": ["vp check --fix"],
    /**
     * `audit` rather than `dead-code`: it reviews only the CHANGED files, so a
     * commit is gated on what it introduced rather than the standing backlog.
     *
     * `sh -c ... --` so lint-staged's filenames land as ignored positional
     * args — `audit` derives the changed set from git itself and rejects paths.
     * `FALLOW_AUDIT_BASE` because the base is otherwise a merge-base against an
     * upstream `trunk` does not have, and unset it errors out instead of
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
