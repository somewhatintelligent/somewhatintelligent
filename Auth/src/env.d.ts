/// <reference types="vite/client" />

import type { IdentityEnv } from "./identity-env.ts";

/**
 * The `cloudflare:workers` env surface.
 *
 * `AUTH` is a bare `Service` stub here. Its method shapes are recovered in
 * exactly one place — `lib/bae.server.ts` — by wrapping the stub with
 * `toRpcAsync` against the Worker class's own type, so this app's calls are
 * checked against what `Workers/Bae.ts` actually implements rather than against
 * a re-declared interface.
 *
 * `@cloudflare/workers-types` must be in `compilerOptions.types` for that to
 * mean anything: the binding type ends in an intersection with the ambient
 * `Service`, and without the package the whole thing collapses to `any` with no
 * error, no hover, and no diagnostic.
 */
declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env extends IdentityEnv {
      AUTH: Service;
    }
  }
}
