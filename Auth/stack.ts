import type { AuthFeatures } from "better-auth-manifest";

import * as Alchemy from "alchemy";

/**
 * What Auth publishes to every other stack: where it is, and how a caller is
 * expected to reach it.
 *
 * This is the contract, and it is the reason Auth deploys first. Nothing
 * downstream re-derives these — a second copy of the origin is a second thing
 * that can disagree with what Better Auth actually mints.
 *
 * Every field is something a DIFFERENT stack can act on, and that is the whole
 * test for belonging here. A URL is the entire cross-stack vocabulary: a
 * service binding names a resource this stack owns and cannot be handed out,
 * so the script name and the mount path stay internal — they only mean
 * something to the app that proxies the auth server, which lives in here.
 */
export interface AuthRouting {
  /** Where to send someone to sign in. */
  readonly origin: string;
  /** The auth server's HTTP surface, for an app resolving a session itself. */
  readonly authBaseURL: string;
  /**
   * The `Domain` session cookies are scoped to, or `null` for host-only.
   *
   * `null` outside production is not a gap to fill in later: every other stage
   * answers on `*.workers.dev`, which is on the Public Suffix List, so no
   * cookie can be shared across sibling apps there at all. A downstream app in
   * such a stage must resolve identity through the auth server rather than by
   * reading a cookie it will never receive.
   */
  readonly cookieDomain: string | null;
  /**
   * What this deployment has switched on, read off the configuration the auth
   * worker runs.
   *
   * A consuming stack projects these into `VITE_` defines, which the Vite build
   * substitutes as literals — so a surface that is off is ABSENT from the
   * bundle rather than hidden in it. That only works for a SCALAR define: a
   * blob parsed at runtime, or a member access on a substituted object literal,
   * both survive the build (measured against this repo's rolldown). Branch on
   * one boolean per surface; iterate the arrays.
   */
  readonly features: AuthFeatures;
  /**
   * The adopted D1 database's id.
   *
   * Resolving it is the production adoption guard — see `backend/database.ts`
   * for why adoption can silently target the wrong database, and
   * `alchemy.run.ts` for the check that refuses it.
   */
  readonly databaseId: string;
}

export class Auth extends Alchemy.Stack<Auth, AuthRouting>()("SomewhatIntelligentAuth") {}
