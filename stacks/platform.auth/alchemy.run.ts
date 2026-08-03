import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import { Layer } from "effect";

import { AuthModule } from "platform.auth/module";

import { Auth } from "./index.ts";

/**
 * Composition, and deliberately nothing else.
 *
 * Everything this stack deploys is declared in `apps/platform.auth/module.ts`,
 * which owns its own resources and reads its own stage. What lives here is what
 * only a composer can know: which state store, which providers, and how to
 * treat a resource someone else already owns.
 *
 * `.make` binds the effect to the handle in `./index.ts`, so a module that
 * stopped returning something matching `AuthRouting` fails to typecheck HERE —
 * at the point the contract is published — rather than passing a broken shape
 * to whichever stack yields it next.
 *
 * UNLIKE `stacks/mezedes`, this stack has a typed handle, and the difference is
 * whether anything reads it. Mezedes is a product: it consumes the platform and
 * nothing consumes it, so a handle there published a contract with no reader and
 * fallow reported the interface as dead. Auth is read by every stack that needs
 * a session, so the handle earns itself.
 */
export default Auth.make(
  {
    state: Cloudflare.state(),
    /**
     * Drizzle alongside Cloudflare because the schema resource is generated at
     * deploy time — see `apps/platform.auth/api/schema.ts` and the migrations
     * it feeds into the D1.
     */
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
  },
  /**
   * Applied to the MODULE rather than around `.make`, which is where it sat
   * before the split: `adopt` provides a service to the effect that declares
   * the resources, so it has to wrap that effect and not the compiled stack.
   *
   * Adoption is what lets the production D1 be taken over by name rather than
   * created fresh — and `module.ts` carries the guard that turns a wrong name
   * into a failed deploy instead of a green one onto an empty database.
   */
  AuthModule.pipe(Alchemy.AdoptPolicy.adopt()),
);
