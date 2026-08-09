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
export const PRODUCTION_STAGE = "production";

/** The zone every public somewhatintelligent hostname sits under. */
export const PRODUCTION_ZONE = "somewhatintelligent.ca";

/**
 * `auth_domain` from `GET /accounts/{account_id}/access/organizations`.
 *
 * A literal because it cannot be derived: `Access.Organization` takes
 * `authDomain` as a required PROP rather than reporting it, so adopting the org
 * would need this value anyway.
 */
export const TEAM_DOMAIN = "https://somewhatintelligent.cloudflareaccess.com";

/**
 * The account's Cloudflare identity provider, `type: "cloudflare"` from
 * `GET /accounts/{account_id}/access/identity_providers`.
 *
 * A literal for a different reason: alchemy CAN adopt an existing IdP, but
 * adopting it means managing it, and this one is Cloudflare's to manage.
 */
export const CLOUDFLARE_IDP = "47a38340-afe7-4c13-8eda-38aca32858a3";

/** Where a customer or a reader writes to. Derived, so it cannot outlive the zone. */
export const SUPPORT_EMAIL = `hello@${PRODUCTION_ZONE}`;

/**
 * The profiles that are the same account as this one, and the whole of that
 * claim in one place.
 *
 * It is made twice on the public site — as `rel="me"` links in the footer, and
 * as `sameAs` in the storefront's JSON-LD — and a claim made in only one of the
 * two is the one an identity verifier disbelieves. Both now read this.
 *
 * `label` is the accessible name the footer's anchor carries; the marks
 * themselves stay in the footer, because an SVG path is not a name this
 * package has any business holding.
 */
export const SOCIAL_PROFILES = [
  { label: "GitHub", url: "https://github.com/somewhatintelligent/somewhatintelligent" },
  { label: "Instagram", url: "https://instagram.com/somewhatintelligent" },
] as const;

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

/**
 * The account's `workers.dev` subdomain. Off production every unit answers at
 * `https://<script>.${ACCOUNT_SUBDOMAIN}.workers.dev` and claims no zone
 * record, so no two stages ever contend for a hostname.
 */
export const ACCOUNT_SUBDOMAIN = "apostoli-geyer";

export const workersDevHost = (script: string): string =>
  `${script}.${ACCOUNT_SUBDOMAIN}.workers.dev`;

/**
 * The per-stage script name of every unit with a preview surface, in ONE place,
 * because the stage's shared Access application has to enumerate them as
 * destinations BEFORE any of those workers resolve — it is declared in the auth
 * stack and three of the five workers live in stacks it never imports.
 *
 * So the coupling is real and the only question is whether it is written down.
 * Here, a unit that renames renames its worker and its Access destination in
 * the same diff; spelled inline at both ends, they drift and the symptom is a
 * preview that 200s to the whole internet.
 *
 * PRODUCTION NAMES ARE NOT HERE. Production pins frozen physical names inside
 * each app — `si-identity-prod`, `agentic-inbox-si`, the alchemy-generated ones
 * — and never routes through this table. Adding one here would invite a rename
 * that replaces a live worker.
 */
export const PREVIEW_SCRIPTS = {
  /** Matches what `apps/platform.auth/shared/ingress.ts` already builds. */
  auth: (stage: string) => `si-identity-${stage}`,
  site: (stage: string) => `si-site-${stage}`,
  media: (stage: string) => `si-commerce-media-${stage}`,
  /** Matches what `apps/platform.commerce/module.ts` already builds. */
  operator: (stage: string) => `si-commerce-operator-${stage}`,
  mezedes: (stage: string) => `si-mezedes-${stage}`,
  inbox: (stage: string) => `agentic-inbox-si-${stage}`,
} as const;
