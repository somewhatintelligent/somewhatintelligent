import type { AuthFeatures } from "better-auth-manifest";

import * as Alchemy from "alchemy";

/**
 * What Auth publishes to every other stack, and the reason it deploys first.
 *
 * A field belongs here only if a DIFFERENT stack can act on it, which in
 * practice means a URL: a service binding names a resource this stack owns and
 * cannot be handed out, so the script name and the mount path stay internal.
 * Nothing downstream re-derives these — a second copy of the origin is a second
 * thing that can disagree with what Better Auth mints.
 */
export interface AuthRouting {
  /** Where to send someone to sign in. */
  readonly origin: string;
  /** The auth server's HTTP surface, for an app resolving a session itself. */
  readonly authBaseURL: string;
  /**
   * The `Domain` session cookies are scoped to, or `null` for host-only.
   *
   * `null` outside production is not a gap to fill in later — see
   * `Ingress.cookieDomain`. A downstream app in such a stage must resolve
   * identity through the auth server, not through a cookie it never receives.
   */
  readonly cookieDomain: string | null;
  /**
   * What this deployment has switched on, read off the configuration the auth
   * worker runs. A consuming stack projects these into `VITE_` defines — see
   * `surfaces.ts` for which shapes survive the build and which fold away.
   */
  readonly features: AuthFeatures;
  /**
   * The adopted D1 database's id. Resolving it IS the production adoption
   * guard — see `backend/database.ts` and the check in `alchemy.run.ts`.
   */
  readonly databaseId: string;
}

export class Auth extends Alchemy.Stack<Auth, AuthRouting>()("SomewhatIntelligentAuth") {}
