import * as Context from "effect/Context";

export const AUTH_ORIGIN = "AUTH_ORIGIN";

export const AUTH_COOKIE_DOMAIN = "AUTH_COOKIE_DOMAIN";

export const UNRESOLVED_ORIGIN = "https://auth.unresolved.invalid";

/**
 * Where the auth server believes it is, carried across the deploy boundary as a
 * `plain_text` binding computed from the stage.
 *
 * Better Auth mints every URL it issues from `baseURL`, so an empty value makes
 * `new URL("")` throw on the first request.
 */
export class Origin extends Context.Service<
  Origin,
  {
    readonly origin: string;
    /** `null` for host-only cookies. See `Ingress.cookieDomain`. */
    readonly cookieDomain: string | null;
  }
>()("Auth/Origin") {}
