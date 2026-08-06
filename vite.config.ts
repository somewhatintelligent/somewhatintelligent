import type { OxlintConfig } from "oxlint";
import { defineConfig } from "vite-plus";

/**
 * `effecttsgo` exists only in the Oxlint binary that `effect-tsgo patch
 * --oxlint` installs; the published `oxlint` package types its plugin list as a
 * CLOSED UNION (`LintPluginOptionsSchema`), and the patch swaps the native
 * binding rather than the type definitions. So no release of `oxlint` will ever
 * name this plugin, and the assertion is permanent rather than a version skew
 * to wait out. Naming it once here keeps the rest of the `plugins` array below
 * type-checked.
 */
const effecttsgo = "effecttsgo" as unknown as NonNullable<OxlintConfig["plugins"]>[number];

const worktrees = "**/worktrees/**";

export default defineConfig({
  // Fallow's dead-code and audit gates are off: the baselines had been raised
  // to absorb findings rather than the findings fixed, so the gate was passing
  // on a floor that only ever went up. Run `bunx fallow dead-code` by hand.
  staged: {
    "*": ["vp check --fix"],
  },
  fmt: {
    ignorePatterns: [
      "**/dist/**",
      "apps/*/design/**",
      "**/.alchemy/**",
      "**/*.gen.ts",
      "**/migrations/**",
      worktrees,
    ],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    /**
     * THE EFFECT LANGUAGE SERVICE, and the only place it is configured.
     *
     * `effecttsgo` is not an npm package you can add to `jsPlugins` — it is
     * compiled into the Oxlint binary by `effect-tsgo patch --oxlint`, which the
     * root `prepare` script re-applies after every install. That patch also
     * swaps the `tsc` binary inside `@typescript/typescript-*`, so the same
     * rules reach editors and `vp check`'s type-check pass without a
     * `compilerOptions.plugins` entry in a single tsconfig. THAT is the point:
     * the old `@effect/language-service` plugin had to be repeated in every
     * package's tsconfig, was silently dead under TypeScript 7 (native tsgo
     * loads no JS language-service plugins), and drifted between packages.
     *
     * The `plugins` entry is what upstream documents — its own smoke-test
     * fixture (`testdata/tests/oxlint/.oxlintrc.json`) and every generated rule
     * doc configure it exactly this way, and there is no other path: with the
     * entry removed the Effect rules go quiet, and naming a rule under `rules`
     * alone does not enable them either. Both were measured, not assumed.
     *
     * LISTING `plugins` AT ALL overwrites Oxlint's base set rather than
     * appending, so the four defaults (`eslint`, `typescript`, `unicorn`,
     * `oxc`) have to be re-stated here or they silently switch off.
     *
     * The patch pins exact versions — `@effect/tsgo` 0.26.7 accepts only
     * `oxlint` 1.76.0 and `oxlint-tsgolint` 7.0.2001 — and vite-plus 0.2.7
     * bundles `oxlint` 1.75.0, which is why the root package.json overrides it.
     * When vite-plus moves, `prepare` fails loudly on a version mismatch rather
     * than leaving Effect unlinted; bump `@effect/tsgo` and the two catalog
     * pins together.
     */
    plugins: ["eslint", "typescript", "unicorn", "oxc", effecttsgo],
    ignorePatterns: [
      "**/dist/**",
      "apps/*/design/**",
      "**/.alchemy/**",
      "**/*.gen.ts",
      "**/migrations/**",
      worktrees,
    ],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    /**
     * THE CLIENT BUNDLE, and the only place an alchemy import is a defect.
     *
     * NOT "runtime may not import alchemy" — the Workers do, correctly and
     * everywhere: `RuntimeContext`, `Workers.WorkerEnvironment`,
     * `SecretsStore.ReadSecret`, the D1 and R2 accessors are runtime APIs. What
     * must never happen is deploy machinery reaching a browser.
     *
     * `excludeFiles` rather than `!`-prefixed entries inside `files`: negations
     * there are not honoured and the rule fires on the paths anyway. TanStack
     * Start keeps the site's Worker entry and its `.server.ts` modules in the
     * same tree as client routes, so those two patterns are the whole exemption.
     *
     * No `node:` rule. `nodejs_compat` is on and `AsyncLocalStorage` is a
     * supported Workers API — lib.better-auth-effect's Boundary depends on it.
     */
    overrides: [
      {
        files: ["apps/*/app/**", "apps/*/src/shell/**"],
        excludeFiles: ["apps/*/app/worker.ts", "apps/*/app/**/*.server.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                { group: ["alchemy", "alchemy/*"], message: "ships to a browser" },
                { group: ["cloudflare:workers"], message: "not available in a client bundle" },
                /**
                 * THE SERVER SUBPATHS OF `lib.observability`, because a bare
                 * specifier launders what the two rules above ban by name.
                 *
                 * `lib.observability/server` imports `alchemy/Telemetry` and
                 * `lib.observability/tanstack-start/server` imports
                 * `node:async_hooks`; neither string appears in a route that
                 * imports them, so the patterns above never see it and
                 * `vp check` passes on exactly the shape that took the console
                 * down — a client-reachable module reaching a Worker-only API.
                 *
                 * The legitimate consumers are the two `app/worker.ts` entries,
                 * which `excludeFiles` above already exempts.
                 */
                {
                  group: ["lib.observability/server", "lib.observability/tanstack-start/server"],
                  message: "server-only: reaches alchemy or node:async_hooks",
                },
              ],
            },
          ],
        },
      },
    ],
  },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", worktrees],
  },
  run: {
    cache: true,
  },
});
