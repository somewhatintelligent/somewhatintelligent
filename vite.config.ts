import { defineConfig } from "vite-plus";

/**
 * THE AUDIT HALF OF THE GATE, stood down — branch `rearch` only.
 *
 * NARROWED, not removed: `vp check --fix` still runs on every commit, because
 * format/lint/typecheck is exactly the check a rename needs and it stays green
 * throughout. What comes off is `fallow audit`, and for a reason its own
 * docstring below predicts — audit attributes findings by FILE PATH, and this
 * branch moves every file in the repo. The dupes and health baselines absorb
 * that; nothing absorbs it for the dead-code half, which has no baseline
 * because its floor is currently zero.
 *
 * An empty `staged` is not an option — lint-staged rejects it outright
 * ("Configuration should not be empty"), which is how this arrived at a
 * narrowed gate rather than no gate.
 *
 * The audit task is left VERBATIM rather than deleted, so restoring it at
 * commit 12 is a one-line diff and a reviewer can see nothing was quietly
 * dropped. Run it on demand with `REARCH_GATE=1 git commit`.
 *
 * DELETE THIS CONST at commit 12. A gate that stays optional is not a gate.
 */
const AUDIT_STOOD_DOWN = process.env.REARCH_GATE !== "1";

export default defineConfig({
  staged: {
    "*": [
      "vp check --fix",
      ...(AUDIT_STOOD_DOWN
        ? []
        : [
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
             *
             * The BASELINES are what make that promise survive a rename. `audit`
             * attributes a finding to the changeset by FILE PATH, so moving a file
             * gives every finding in it a path the base snapshot never had and the
             * whole standing backlog reads as introduced here. A baseline matches on
             * the finding instead, so only genuinely new duplication and complexity
             * gate a commit.
             *
             * Re-save them (`fallow dupes|health --save-baseline <path>`) when the
             * backlog SHRINKS — they are a floor, not a target, and a stale one
             * silently forgives a regression back up to it.
             */
            () =>
              "bunx fallow audit --base HEAD" +
              " --dupes-baseline .fallow-baselines/dupes.json" +
              " --health-baseline .fallow-baselines/health.json",
          ]),
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
