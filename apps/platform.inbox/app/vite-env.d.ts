// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Written out by hand rather than read from `.react-router/types/`.
 *
 * `react-router typegen` generates this same declaration into a gitignored
 * directory, which makes a clean clone fail typecheck until someone remembers
 * to run it — and the repo's gate is meant to work with nothing remembered.
 * Nothing here imports a generated `./+types/*` route module, so this one
 * declaration is the whole of what typegen was providing.
 *
 * Re-sync it from `.react-router/types/+server-build.d.ts` if a React Router
 * upgrade adds fields; a missing one surfaces as a type error at the single
 * `import("virtual:react-router/server-build")` in `workers/app.ts`.
 */
declare module "virtual:react-router/server-build" {
  import type { ServerBuild } from "react-router";
  export const assets: ServerBuild["assets"];
  export const assetsBuildDirectory: ServerBuild["assetsBuildDirectory"];
  export const basename: ServerBuild["basename"];
  export const entry: ServerBuild["entry"];
  export const future: ServerBuild["future"];
  export const isSpaMode: ServerBuild["isSpaMode"];
  export const prerender: ServerBuild["prerender"];
  export const publicPath: ServerBuild["publicPath"];
  export const routeDiscovery: ServerBuild["routeDiscovery"];
  export const routes: ServerBuild["routes"];
  export const ssr: ServerBuild["ssr"];
  export const allowedActionOrigins: ServerBuild["allowedActionOrigins"];
  export const unstable_getCriticalCss: ServerBuild["unstable_getCriticalCss"];
}
