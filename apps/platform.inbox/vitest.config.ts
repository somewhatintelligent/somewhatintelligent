// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { defineConfig } from "vite-plus";

// Separate from vite.config.ts on purpose: that config wires up the
// Cloudflare Vite plugin + React Router dev/build pipeline, which vitest
// doesn't need (and shouldn't couple to) for plain unit tests over
// shared/**/* and workers/lib/**/* pure functions.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.ts"],
    exclude: ["node_modules/**", "build/**", ".react-router/**", ".wrangler/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
