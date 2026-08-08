/**
 * The Stripe ACCOUNT this organisation bills through, and the rules that keep a
 * deployment on the right one.
 *
 * There is exactly one Stripe account behind everything here. The store settles
 * orders against it (`platform.commerce`) and the IdP sells subscriptions
 * against it (`platform.auth`), and they must be the same account or a customer
 * would exist twice — once per surface — with two payment methods, two receipts
 * and no way for support to reconcile them. That is why the secret key's
 * variable name lives HERE rather than in either app: a second name is a second
 * account waiting to happen.
 *
 * WHAT DOES NOT LIVE HERE: the webhook signing secret. Stripe mints one per
 * ENDPOINT, not per account, so the store's hooks worker and the IdP's
 * `/api/auth/stripe/webhook` have different ones by construction and each app
 * names its own. Putting a single `STRIPE_WEBHOOK_SIGNING_SECRET` here would
 * read as shared and be wrong on whichever surface deployed second.
 *
 * `infra`, not a package: {@link environmentFor} maps a {@link Tier}, and
 * `Tier` is decoded from a validated stage — a `platform.*` package may not
 * import that (see the boundary rules in `.fallowrc.jsonc`), and restating the
 * union structurally would be the same duplication one level down.
 */
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import Stripe from "stripe";

import type { Tier } from "./stage/StandardizedStage.ts";

/**
 * The one credential every surface reads, and the reason the value is not in
 * the name: the separation between accounts lives in which encrypted `.env`
 * file a stage decrypts, not in the spelling of a variable. See
 * `apps/platform.commerce/services/StripeConfig.ts` for the full account of why
 * three names collapsed into one.
 */
export const STRIPE_SECRET_KEY = "STRIPE_SECRET_KEY";

/**
 * Which Stripe account a deployment talks to.
 *
 *   dev     — the developer's machine. `stripe listen` mints the store's
 *             signing secret; the IdP's is whatever the developer registered.
 *   preprod — the SANDBOX account. Test keys, test webhooks.
 *   prod    — the LIVE account, and `livemode` events only.
 */
export type StripeEnvironment = "dev" | "preprod" | "prod";

/**
 * Map a deploy TIER onto a Stripe environment.
 *
 * A tier, not a raw stage string, and that is the whole point: `Tier` is decoded
 * from a validated stage, so the set of inputs is closed and the mapping is
 * total. Matching `stage === "prod"` — a string that is not a legal stage at all
 * — meant a typo'd stage fell through to `dev` while a crafted one could claim
 * `prod` and load a live key.
 *
 * Combined with {@link assertKeyMatchesEnvironment}, LIVE KEYS ARE REACHABLE
 * ONLY FROM THE `production` TIER.
 */
export const environmentFor = (tier: Tier): StripeEnvironment =>
  tier === "production" ? "prod" : tier === "staging" ? "preprod" : "dev";

/**
 * A key that does not match the environment asking for it.
 *
 * Separate from a missing key on purpose: absent secrets are a normal state on a
 * contributor's machine, but a live key in a preprod slot is a mistake nobody
 * should be allowed to deploy past.
 */
export class StripeKeyMismatch extends Schema.TaggedErrorClass<StripeKeyMismatch>()(
  "StripeKeyMismatch",
  {
    environment: Schema.String,
    detail: Schema.String,
  },
) {}

/**
 * Whether a key settles real money. DERIVED from the key's own prefix rather
 * than configured, because it must agree with the account in use — a live key
 * with test-mode gating would settle real charges against fake events, and the
 * inverse would ignore real ones.
 */
export const livemodeOf = (secretKey: Redacted.Redacted<string>): boolean =>
  Redacted.value(secretKey).startsWith("sk_live_");

/**
 * The guard that makes the environment mapping load-bearing rather than
 * decorative. Without it a live key pasted into the sandbox slot deploys
 * happily and starts taking real payments on a staging surface.
 *
 * Returns the mismatch rather than raising it, so a caller can decide whether it
 * is fatal — the store refuses to deploy at all, and the IdP has sign-in to keep
 * serving. `null` means the key and the environment agree.
 */
/**
 * The Stripe API version every surface here is written against.
 *
 * ONE PIN FOR ONE ACCOUNT, and that is the reason it is not a literal in each
 * adapter. The store and the IdP read the same Customer and Subscription
 * objects; two versions means two shapes for one record, and the way that
 * happens is a `stripe` catalog bump — the SDK types `apiVersion` as a literal
 * union, so the bump type-errors wherever the constant lives and leaves any
 * second copy stale but still legal.
 */
export const STRIPE_API_VERSION = "2026-07-29.dahlia";

/**
 * A Stripe client for a Cloudflare Worker.
 *
 * `createFetchHttpClient` because Workers have no Node http stack. It is also
 * correct on the `workerd` build, which already defaults to fetch — stating it
 * means the client is right whichever build condition the bundler resolves,
 * which is not a thing to leave to the bundler.
 */
export const stripeClient = (secretKey: Redacted.Redacted<string>): Stripe =>
  new Stripe(Redacted.value(secretKey), {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: STRIPE_API_VERSION,
  });

export const assertKeyMatchesEnvironment = (
  environment: StripeEnvironment,
  livemode: boolean,
): StripeKeyMismatch | null => {
  if (environment === "prod" && !livemode) {
    return new StripeKeyMismatch({
      environment,
      detail: `${STRIPE_SECRET_KEY} does not hold a live key; prod must not run on test keys`,
    });
  }
  if (environment !== "prod" && livemode) {
    return new StripeKeyMismatch({
      environment,
      detail: `${STRIPE_SECRET_KEY} holds a LIVE key; ${environment} must use a test key`,
    });
  }
  return null;
};
