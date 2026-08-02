/// <reference types="vite/client" />

import type { AuthDefines } from "../surfaces.ts";
import type { IdentityEnv } from "./identity-env.ts";

/**
 * The auth surfaces, as build-time constants. Typed from the same `SURFACES`
 * list the deploy projects, so `VITE_AUTH_PASKEY` is a compile error rather
 * than `undefined` rendering as "this surface is off".
 *
 * Read each name LITERALLY: Vite substitutes text for an exact key, so
 * ``import.meta.env[`VITE_AUTH_${id}`]`` never matches and survives to runtime
 * as a lookup on an object the bundle does not contain.
 */
declare global {
  interface ImportMetaEnv extends AuthDefines {}
}

/**
 * The `cloudflare:workers` env surface.
 *
 * `AUTH` is a bare `Service` stub. Its method shapes are recovered in exactly
 * one place — `lib/bae.server.ts` — by wrapping the stub with `toRpcAsync`
 * against the Worker class's own type, so calls are checked against what
 * `backend/worker.ts` implements rather than a re-declared interface.
 *
 * `@cloudflare/workers-types` must stay in `compilerOptions.types`: the binding
 * type intersects the ambient `Service`, and without the package the whole
 * thing collapses to `any` with no error and no diagnostic.
 */
declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env extends IdentityEnv {
      AUTH: Service;
    }
  }
}
