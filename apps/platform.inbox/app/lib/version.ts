// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Build-time app version, for the small "vX.Y.Z (sha)" label shown in the
 * sidebar footer. `__APP_VERSION__`/`__APP_COMMIT__` are injected by
 * vite.config.ts's `define` from package.json + `git rev-parse --short HEAD`,
 * with safe fallbacks baked in at build time when either is unavailable.
 */
const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
const APP_COMMIT: string = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown";

/** "v0.1.0 (abc1234)" — or just "v0.1.0" if the commit sha is unavailable. */
export function formatAppVersion(): string {
  return APP_COMMIT === "unknown" ? `v${APP_VERSION}` : `v${APP_VERSION} (${APP_COMMIT})`;
}
