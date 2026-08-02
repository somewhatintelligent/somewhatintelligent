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
       * `--base HEAD` because a PRE-COMMIT gate should score the commit being
       * made. The default base is the merge-base against the upstream, which
       * would re-judge every commit not yet pushed and fail this one for a
       * finding an earlier one introduced.
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
