/**
 * The app-side door onto `shared/scopes.ts`.
 *
 * The list itself lives in `shared/` because the auth server declares the same
 * scopes to Better Auth, and a consent screen with its own copy of them is a
 * consent screen that eventually describes a scope the server no longer issues.
 * This file exists so routes keep importing `@/lib/scopes` rather than reaching
 * three directories up.
 */
export { scopeCopy, scopeLabel } from "../../shared/scopes.ts";
