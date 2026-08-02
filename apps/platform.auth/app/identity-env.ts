/**
 * The identity app's env, declared by hand.
 *
 * One binding and two vars, and that is the whole surface. This app holds no D1,
 * R2, KV, queue, or Durable Object binding: every piece of auth state is
 * reachable ONLY through `AUTH`, so a bug in a route cannot read the user table
 * directly. Adding a data binding here is the change that would break that.
 *
 * The same property the console has, arrived at differently — the console is
 * gated at its boundary by Cloudflare Access, and this app cannot be, because it
 * IS the login. So the binding is the whole security boundary here, and the auth
 * server re-checks the caller's cookie on every method rather than trusting that
 * the caller reached it.
 */
export type { IdentityEnv } from "../alchemy.run.ts";
