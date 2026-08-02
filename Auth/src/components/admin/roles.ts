/**
 * Account roles the admin UI offers in its pickers — a UI mirror of
 * better-auth's stock admin plugin (roles `user`/`admin`, default `user`,
 * multi-role stored as csv). This list only controls what the pickers
 * offer: growing the real role set means wiring `admin.{adminRoles,ac,roles}`
 * in `workers/guestlist/src/config.ts`; adding a role here alone would
 * offer one the auth layer grants no permissions for.
 */
export const AVAILABLE_ROLES = ["user", "admin"] as const;

export type PlatformRole = (typeof AVAILABLE_ROLES)[number];

/** Preselected role for new accounts (better-auth's `defaultRole`). */
export const DEFAULT_ROLE: PlatformRole = "user";
