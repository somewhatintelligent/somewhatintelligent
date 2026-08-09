import * as Context from "effect/Context";

/**
 * The audiences the token endpoint will mint a JWT access token for, carried
 * across the deploy boundary the same way the origin is: a `plain_text` binding
 * computed from the stage.
 *
 * A binding rather than a constant because the answer is per stage and the
 * Worker has no stage — see `shared/resources.ts` for why production is the
 * only one that can be derived.
 */
export const OAUTH_RESOURCES = "OAUTH_RESOURCES";

/**
 * SPACE-SEPARATED, like every other audience list OAuth carries. A binding is
 * one string; JSON would be a second format to get wrong for no gain, and no
 * audience is a URL with a space in it.
 */
export const encodeAudiences = (audiences: ReadonlyArray<string>): string => audiences.join(" ");

/** Absent, empty, or not a string all mean the same thing: this stage serves no resource. */
export const decodeAudiences = (value: unknown): ReadonlyArray<string> =>
  typeof value === "string" ? value.split(" ").filter((entry) => entry !== "") : [];

/**
 * The protected resources this deployment answers for.
 *
 * The auth server's own base URL is NOT in here. It is always a valid audience
 * — Better Auth's own `/oauth2/userinfo` is addressed by it — and `api/config.ts`
 * adds it beside these, so this stays a list of the OTHER things a token can be
 * made out to.
 */
export class Resources extends Context.Service<
  Resources,
  { readonly audiences: ReadonlyArray<string> }
>()("Auth/Resources") {}
