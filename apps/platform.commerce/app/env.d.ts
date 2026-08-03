/// <reference types="vite/client" />

import type { OperatorEnv } from "./operator-env.ts";

/**
 * The `cloudflare:workers` env surface, for the `.server.ts` modules that reach
 * it directly rather than taking `env` as a `fetch` argument.
 *
 * `COMMERCE` and `SETTLEMENT` are bare `Service` stubs here. Their method
 * shapes are recovered in exactly one place — `lib/commerce.server.ts` — by
 * wrapping each stub with `toRpcAsync` against the Worker class's own type, so
 * every call is checked against what `workers/CommerceSurface.ts` implements
 * rather than an interface re-declared beside it.
 *
 * `@cloudflare/workers-types` must stay in `compilerOptions.types`: these
 * binding types intersect the ambient `Service`, and without the package the
 * whole thing collapses to `any` with no error and no diagnostic.
 */
declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env extends OperatorEnv {
      COMMERCE: Service;
      SETTLEMENT: Service;
    }
  }
}
