/**
 * Identity's PUBLIC address for `path`, mount included.
 *
 * Better-auth's email flows (magic-link verify, reset-password callback)
 * redirect from GUESTLIST — a passthrough mount, so bouncer never rewrites
 * the Location header. Any callback/redirect URL handed to those flows must
 * therefore already be identity's public URL including its `/account` vmf
 * mount (`IDENTITY_URL`), never a path anchored at the bare origin.
 */
export function publicIdentityHref(path: string): string {
  const base = import.meta.env.IDENTITY_URL || window.location.origin;
  return `${base.replace(/\/+$/, "")}${path}`;
}
