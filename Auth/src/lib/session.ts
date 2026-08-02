/**
 * What "who is this" means in this app, derived rather than declared.
 *
 * The session type comes off the RPC method's own return type, so it is whatever
 * the auth server actually answers with — including every field the plugin set
 * contributes (`role` from admin, `username`, `activeOrganizationId`). Declaring
 * an interface here instead would be a second copy that silently stops matching
 * the day a plugin is added.
 */
import type { baeClient } from "./bae.server.ts";

type SessionEnvelope = Awaited<ReturnType<ReturnType<typeof baeClient>["getSession"]>>;

/** The resolved session, or `null` for an anonymous request. */
export type IdentitySession = NonNullable<SessionEnvelope["session"]>;

/** The person. `session.user`, named, because that is what routes render. */
export type IdentityUser = IdentitySession["user"];

/**
 * `user.role` is a COMMA-SEPARATED string (`"admin,user"`) or an array — Better
 * Auth's admin plugin splits on commas before matching `adminRoles`. Comparing
 * the raw value with `=== "admin"` silently locks out every multi-role user.
 *
 * Ported from si's `@somewhatintelligent/kit/roles`, which does not exist in
 * v2. Client-safe: no imports, no server-only references.
 */
export function hasRole(
  roles: string | ReadonlyArray<string> | null | undefined,
  role: string,
): boolean {
  if (!roles) return false;
  const list = Array.isArray(roles) ? roles : String(roles).split(",");
  return list.map((entry) => entry.trim()).includes(role);
}

/** `hasRole(roles, "admin")`. */
export function isAdminRole(roles: string | ReadonlyArray<string> | null | undefined): boolean {
  return hasRole(roles, "admin");
}

/** Whether a resolved session belongs to an admin. */
export function isAdmin(session: IdentitySession | null): boolean {
  if (session === null) return false;
  const user = session.user as { role?: string | ReadonlyArray<string> | null };
  return isAdminRole(user.role);
}
