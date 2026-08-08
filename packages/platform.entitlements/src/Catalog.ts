/**
 * THE CATALOGUE — the single place a tier is mapped to what it buys, and the
 * single place a tier is mapped to a Stripe price.
 *
 * Both directions live here on purpose. The IdP builds the Better Auth Stripe
 * plugin's `plans` from {@link PURCHASABLE_PLANS}, and every app resolves
 * capabilities from {@link TIERS}; one file means a price and its entitlements
 * cannot drift apart, which is the drift that sells someone a plan that grants
 * nothing.
 *
 * PRICES ARE NAMED BY LOOKUP KEY, NEVER BY `price_…` ID. A lookup key is a
 * string this repository chooses and attaches to a Price in the Stripe
 * dashboard, and the SAME key can exist in both test mode and live mode. A
 * price id cannot: `price_1AbC…` is minted per mode, so pinning ids would need a
 * per-stage variable for every tier and every interval, and getting one wrong
 * charges the wrong amount rather than failing. With lookup keys the catalogue
 * is stage-independent and checked in, and the only thing an operator does per
 * environment is create prices carrying these keys.
 *
 * A TIER IS NEVER DELETED. Retiring one means `purchasable: false`: it leaves
 * the pricing table and the plugin's plan list, while every subscriber still
 * holding it keeps resolving to the entitlements they paid for. Deleting the
 * entry instead makes {@link tierIdOf} fail to recognise their `subscription.plan`
 * and silently drops them to `free`.
 */
import type { Entitlements } from "./Entitlements.ts";

export interface TierPrices {
  /** Stripe Price `lookup_key` for the monthly price. */
  readonly monthly: string;
  /** Stripe Price `lookup_key` for the annual price, or `null` if none exists. */
  readonly annual: string | null;
}

export interface Tier {
  /**
   * Ordering, not identity. A membership resolves to the HIGHEST-ranked tier it
   * entitles, so gaps are deliberate — a tier inserted between two existing ones
   * takes a number between them and nothing else moves.
   */
  readonly rank: number;
  /** What the pricing table calls it. */
  readonly title: string;
  /** One sentence, in the registry's voice. */
  readonly summary: string;
  /** `null` for the tier nobody buys. */
  readonly prices: TierPrices | null;
  /**
   * Whether it is offered TODAY. `false` retires a tier without revoking it —
   * see the header.
   */
  readonly purchasable: boolean;
  /** Free trial length, or `null`. Stripe grants at most one trial per customer. */
  readonly trialDays: number | null;
  readonly entitlements: Entitlements;
}

/**
 * The ladder.
 *
 * ONE LADDER RATHER THAN A SUBSCRIPTION PER SYSTEM, and that is forced rather
 * than preferred: the Better Auth Stripe plugin supports exactly one active or
 * trialing subscription per reference id, so per-system subscriptions would need
 * a reference id per system and an authorisation rule for each. A ladder whose
 * rungs grant sets of systems expresses the same product with one row per
 * customer.
 *
 * The ids are the strings Stripe stores in `subscription.plan` — the plugin
 * lower-cases the plan name on the way in, so every id here is already lower
 * case and the round trip is the identity.
 */
export const TIERS = {
  free: {
    rank: 0,
    title: "Reader",
    summary: "An account, the shop, and everything published in the open.",
    prices: null,
    purchasable: false,
    trialDays: null,
    entitlements: {
      "systems.mezedes": false,
      "systems.earlyAccess": false,
      "mezedes.mezes": 0,
      "mezedes.serverCode": false,
    },
  },
  subscriber: {
    rank: 10,
    title: "Subscriber",
    summary: "Access to the published systems, with room to actually use them.",
    prices: { monthly: "si_subscriber_monthly", annual: "si_subscriber_annual" },
    purchasable: true,
    trialDays: 14,
    entitlements: {
      "systems.mezedes": true,
      "systems.earlyAccess": false,
      "mezedes.mezes": 25,
      "mezedes.serverCode": true,
    },
  },
  patron: {
    rank: 20,
    title: "Patron",
    summary: "Everything, including what is not finished yet.",
    prices: { monthly: "si_patron_monthly", annual: "si_patron_annual" },
    purchasable: true,
    trialDays: null,
    entitlements: {
      "systems.mezedes": true,
      "systems.earlyAccess": true,
      "mezedes.mezes": "unlimited",
      "mezedes.serverCode": true,
    },
  },
} as const satisfies Record<string, Tier>;

export type TierId = keyof typeof TIERS;

/**
 * What an account holds before it holds anything. Every resolution that finds no
 * entitling subscription lands here, so "not subscribed" and "signed out" are
 * the same answer rather than two code paths.
 *
 * `satisfies`, NOT a `: TierId` annotation. The annotation checks the same thing
 * and then widens the literal away, so `TIERS[BASE_TIER]` becomes the union of
 * every tier — `.prices` types as `TierPrices | null` rather than `null`, and
 * `entitlementsOf(BASE_TIER)` loses the free tier's actual answers.
 */
export const BASE_TIER = "free" satisfies TierId;

/** Narrow a `subscription.plan` string, or `null` when the catalogue has never heard of it. */
export const tierIdOf = (plan: string): TierId | null =>
  Object.hasOwn(TIERS, plan) ? (plan as TierId) : null;

/**
 * A plan as the Better Auth Stripe plugin wants it.
 *
 * STRUCTURAL, not `StripePlan` imported from the plugin. This package must stay
 * dependency-free — it is read by browser bundles — and the shape is four
 * fields the plugin has carried since it existed. `api/config.ts` is where the
 * assignment is checked against the real type.
 */
export interface PlanDescriptor {
  readonly name: string;
  readonly lookupKey: string;
  readonly annualDiscountLookupKey?: string;
  readonly freeTrial?: { readonly days: number };
}

/**
 * The plans the IdP offers, derived rather than restated.
 *
 * `limits` is DELIBERATELY NOT SET. The plugin will echo a plan's `limits` back
 * on `GET /subscription/list`, which looks like a free way to ship entitlements
 * to the browser and is the wrong seam: `limits` is `Record<string, unknown>`,
 * so every reader re-invents the key names and their types, and the values then
 * exist in two places that drift. Apps resolve entitlements from {@link TIERS}
 * with the tier name, which is the only fact that has to travel.
 */
export const PURCHASABLE_PLANS: ReadonlyArray<PlanDescriptor> = Object.entries(TIERS).flatMap(
  ([id, tier]): ReadonlyArray<PlanDescriptor> =>
    tier.purchasable && tier.prices !== null
      ? [
          {
            name: id,
            lookupKey: tier.prices.monthly,
            ...(tier.prices.annual === null ? {} : { annualDiscountLookupKey: tier.prices.annual }),
            ...(tier.trialDays === null ? {} : { freeTrial: { days: tier.trialDays } }),
          },
        ]
      : [],
);
