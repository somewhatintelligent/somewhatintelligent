import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": [
      "vp check --fix",
      /**
       * `audit` rather than `dead-code`: it reviews only the CHANGED files, so
       * a commit is gated on what it introduced rather than the standing
       * backlog.
       *
       * A FUNCTION task, because `staged` appends the staged paths to every
       * string command and `audit` takes no positional arguments — it derives
       * the changed set from git itself. Returning the command from a function
       * is what suppresses the append.
       *
       * `--base HEAD` because the default is a merge-base against an upstream
       * `trunk` does not have; unset, the command errors out instead of
       * gating, which reads as passing.
       */
      () => "bunx fallow audit --base HEAD",
    ],
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
