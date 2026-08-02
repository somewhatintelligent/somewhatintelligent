/**
 * The open-redirect guard — the only thing between a query parameter and where
 * a signed-in person's browser goes next.
 *
 * Peer apps hand this app a raw absolute URL via `?returnTo=`, and it
 * round-trips only to URLs under an apex we control: the apex plus every
 * subdomain, at any depth. That is deliberately the same rule Better Auth
 * applies to `callbackURL` through its `*.{apex}` trustedOrigins, so this
 * client-side guard and the server-side check agree rather than disagreeing
 * quietly. Owning the whole zone means a new app on a new subdomain is trusted
 * by construction.
 */

import { PRODUCTION_ZONE } from "../../shared/ingress.ts";

/**
 * The apex, WITHOUT a leading dot.
 *
 * Still a compile-time constant rather than an env read: a redirect guard that
 * can be misconfigured is one that can be turned off. Reading it from a
 * build-time define means an unset var silently rejects every returnTo — the
 * safe direction, but silently.
 *
 * Taken from `shared/`, which is what the directory is for: the zone this guard
 * trusts and the zone the deploy claims a hostname in have to be the same
 * string, and a second literal here could drift from it without failing a build.
 */
export const APEX = PRODUCTION_ZONE;

/**
 * Is `host` the apex or any subdomain of it, at any depth?
 *
 * The `.` in the suffix check is load bearing: without it,
 * `notsomewhatintelligent.ca` ends with `somewhatintelligent.ca` and passes.
 */
export function isPlatformHost(host: string, apex: string = APEX): boolean {
  const wanted = apex.replace(/^\./, "").toLowerCase();
  if (wanted === "") return false;
  const candidate = host.toLowerCase();
  return candidate === wanted || candidate.endsWith(`.${wanted}`);
}

/**
 * Validate a post-auth redirect target. Returns the value verbatim when it is
 * safe, `undefined` otherwise — never a "corrected" value, because a guard that
 * repairs its input is a guard whose callers stop checking the result.
 *
 * Accepts a same-origin relative path, or an absolute http(s) URL under the apex.
 */
export function resolveReturnTo(
  value: string | undefined,
  apex: string = APEX,
): string | undefined {
  if (!value) return undefined;

  if (value.startsWith("/")) {
    // `//evil.com` is protocol-relative and `/\evil.com` is the UNC-style form
    // browsers also treat as an authority. Both start with `/` and neither is a
    // same-origin path.
    if (value.startsWith("//") || value.startsWith("/\\")) return undefined;
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;

  // `hostname`, not `host`: a port must not defeat the suffix match, and
  // userinfo tricks (`https://somewhatintelligent.ca@evil.com`) have to resolve
  // to the real host rather than the part that looks reassuring.
  return isPlatformHost(url.hostname, apex) ? value : undefined;
}

/** The default landing place for a signed-in person with nowhere else to be. */
const DEFAULT_RETURN_TO = "/account";

/** {@link resolveReturnTo}, with the default applied. */
export function decodeReturnTo(value: string | undefined): string {
  return resolveReturnTo(value) ?? DEFAULT_RETURN_TO;
}
