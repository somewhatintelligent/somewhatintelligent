import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import { Layer } from "effect";

import { AuthModule } from "platform.auth/module";

import { Auth } from "./index.ts";

/**
 * `"SomewhatIntelligentAuth"` is the state key — see `./index.ts`.
 *
 * Drizzle's provider is here because the schema resource generates migrations at
 * deploy time; Cloudflare's alone cannot resolve it.
 *
 * `adopt()` wraps the MODULE, not the stack: it provides a service to the effect
 * that declares the resources. It is what lets the production D1 be taken over
 * by name, and `module.ts` carries the guard that turns a wrong name into a
 * failed deploy rather than a green one onto an empty database.
 */
export default Auth.make(
  {
    state: Cloudflare.state(),
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
  },
  AuthModule.pipe(Alchemy.AdoptPolicy.adopt()),
);
