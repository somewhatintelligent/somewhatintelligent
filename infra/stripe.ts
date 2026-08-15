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
 * `infra`, not a package: {@link assertKeyMatchesTier} takes a {@link Tier},
 * which is decoded from a validated stage — a `platform.*` package may not
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
 * A key that does not match the tier asking for it.
 *
 * Separate from a missing key on purpose: absent secrets are a normal state on a
 * contributor's machine, but a live key on a non-production tier is a mistake
 * nobody should be allowed to deploy past.
 */
export class StripeKeyMismatch extends Schema.TaggedErrorClass<StripeKeyMismatch>()(
  "StripeKeyMismatch",
  {
    tier: Schema.String,
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

/**
 * LIVE KEYS ARE REACHABLE ONLY FROM THE `production` TIER.
 *
 * Takes a `Tier` because `Tier` is decoded from a validated stage, so the input
 * set is closed. Matching a raw stage string instead — `stage === "prod"`, which
 * is not a legal stage at all — let a typo'd stage fall through to the permissive
 * branch while a crafted one could claim production and load a live key.
 *
 * Returns the mismatch rather than raising it, so the caller decides whether it
 * is fatal: the store refuses to deploy at all, the IdP has sign-in to keep
 * serving. `null` means the key and the tier agree.
 */
export const assertKeyMatchesTier = (tier: Tier, livemode: boolean): StripeKeyMismatch | null => {
  if (tier === "production" && !livemode) {
    return new StripeKeyMismatch({
      tier,
      detail: `${STRIPE_SECRET_KEY} does not hold a live key; production must not run on test keys`,
    });
  }
  if (tier !== "production" && livemode) {
    return new StripeKeyMismatch({
      tier,
      detail: `${STRIPE_SECRET_KEY} holds a LIVE key; ${tier} must use a test key`,
    });
  }
  return null;
};
