// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

/**
 * ANCHORED to this file, not to cwd. Alchemy runs the build from wherever the
 * deploy started — the repo root now — and `Website.Vite` passes this directory
 * as Vite's `root` (see `module.ts`), so a cwd-relative read here would find
 * the wrong package.json or none.
 */
const packageDir = import.meta.dirname;

// Build-time app version, rendered subtly in the UI (see app/lib/version.ts).
// Falls back safely when package.json is unreadable or git is unavailable
// (e.g. a source archive with no .git directory).
function readAppVersion(): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(`${packageDir}/package.json`, "utf8"));
    const version = (pkg as { version?: unknown }).version;
    return typeof version === "string" ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The monorepo's HEAD — `git rev-parse` walks up to the repo root from here. */
function readGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: packageDir,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
    __APP_COMMIT__: JSON.stringify(readGitSha()),
  },
  plugins: [tailwindcss(), reactRouter()],
});
