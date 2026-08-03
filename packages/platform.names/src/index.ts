/**
 * The names and ids this account owns.
 *
 * Everything here either IS a name or MAKES one. Nothing computes, fetches, or
 * decides — which is the point of the name: a stack preset or a cross-stack
 * helper put here would be visibly out of place rather than quietly at home.
 *
 * NO DEPENDENCIES, and it has to stay that way. `PRODUCTION_ZONE` is read by
 * client code (`apps/platform.auth/app/lib/return-to.ts`), so anything imported
 * here reaches a browser bundle. The oxlint client rule only sees DIRECT
 * imports, so it would not catch the leak — this comment is the guard.
 *
 * The account id is deliberately absent: alchemy yields it inside a stack.
 */

/** The stage that owns the real data and the real hostnames. */
export const PRODUCTION_STAGE = "prod";

/** The zone every public somewhatintelligent hostname sits under. */
export const PRODUCTION_ZONE = "somewhatintelligent.ca";

/**
 * `auth_domain` from `GET /accounts/{account_id}/access/organizations`.
 *
 * A literal because it cannot be derived: `Access.Organization` takes
 * `authDomain` as a required PROP rather than reporting it, so adopting the org
 * would need this value anyway.
 */
export const TEAM_DOMAIN = "https://geyerconsulting.cloudflareaccess.com";

/**
 * The account's Cloudflare identity provider, `type: "cloudflare"` from
 * `GET /accounts/{account_id}/access/identity_providers`.
 *
 * A literal for a different reason: alchemy CAN adopt an existing IdP, but
 * adopting it means managing it, and this one is Cloudflare's to manage.
 */
export const CLOUDFLARE_IDP = "950ba8bd-98c6-498e-9866-3bb71fd771cc";

/**
 * THE COMMERCE STACK'S STATE KEY, and the reason it is a shared name rather
 * than a literal at each end.
 *
 * `Alchemy.Stack(name, …)` keys persisted state by this string, so it is
 * already load-bearing where the stack declares it — changing it strands
 * everything the old name owns. What earns it a place HERE is the second
 * reader: a cross-stack `Worker.ref` names its target stack as a STRING, which
 * no import graph can follow. Two literals that must agree with nothing
 * checking that they do is precisely the drift this package exists to prevent,
 * and the failure it produces is a ref resolving to nothing at deploy time
 * rather than a type error.
 */
export const COMMERCE_STACK = "PlatformCommerce";

/**
 * A stage name reduced to what a Cloudflare resource name accepts.
 *
 * Stages carry characters resource names do not — `dev_stoli` is the common
 * one. This is for names we build ourselves (`si-identity-<stage>`); alchemy
 * derives its own physical names and needs no help.
 */
export const workerSafeStage = (stage: string): string =>
  stage
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
