/**
 * This app's PUBLIC address for `path`.
 *
 * Better Auth's email flows (magic-link verify, reset-password callback) emit
 * the redirect verbatim, so any callback URL handed to them has to be absolute
 * rather than a path. The app is served at its own origin, so the origin is
 * the answer.
 */
export function publicIdentityHref(path: string): string {
  const base = import.meta.env.IDENTITY_URL || window.location.origin;
  return `${base.replace(/\/+$/, "")}${path}`;
}
