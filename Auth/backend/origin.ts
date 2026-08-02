import * as Context from "effect/Context";

export const AUTH_ORIGIN = "AUTH_ORIGIN";

export const AUTH_COOKIE_DOMAIN = "AUTH_COOKIE_DOMAIN";

export const UNRESOLVED_ORIGIN = "https://auth.unresolved.invalid";

/**
 * Where the auth server believes it is, carried across the deploy boundary.
 *
 * Better Auth mints every URL it issues from `baseURL`, so this is not
 * cosmetic: an empty value makes `new URL("")` throw on the first request. It
 * arrives as a `plain_text` binding computed from the stage — the same
 * mechanism a D1 binding uses to be decided at deploy time and read at runtime.
 */
export class Origin extends Context.Service<
  Origin,
  {
    readonly origin: string;
    /** `null` for host-only cookies. See `Ingress.cookieDomain`. */
    readonly cookieDomain: string | null;
  }
>()("Auth/Origin") {}
