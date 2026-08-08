/**
 * THE WIRE CONTRACT between the IdP and everything that checks a capability, and
 * the policy that turns it into a tier.
 *
 * WHAT TRAVELS IS THE SUBSCRIPTION FACT, NEVER THE RESOLVED ENTITLEMENTS. The
 * IdP owns "who is subscribed to what, until when"; which capabilities that buys
 * is product policy, and product policy is code that ships with the app reading
 * it. Sending a resolved {@link Entitlements} instead would mean the wire format
 * changes shape every time a capability is added, and an app on an older deploy
 * receives a record missing keys it is about to index. Sending the plan means
 * the contract is four fields that have no reason to change, and an app that has
 * not deployed the new capability simply does not offer it — which is the
 * correct behaviour, not a degradation.
 *
 * The cost is that two apps on different deploys of this package can disagree
 * about what `subscriber` buys. That is accepted, and it is bounded: they cannot
 * disagree about WHO is a subscriber, which is the fact money was exchanged for.
 */
import { BASE_TIER, TIERS, tierIdOf, type TierId } from "./Catalog.ts";
import type { Entitlements } from "./Entitlements.ts";

/**
 * Stripe's subscription statuses, plus `none` for an account that has never
 * subscribed.
 *
 * MIRRORED IN FULL rather than collapsed to a boolean at the source. The
 * difference between `past_due` and `unpaid` is the difference between a card
 * that will retry and one that has stopped, and a caller that only receives
 * `entitled: true | false` cannot tell a customer which of the two they are.
 *
 * The ARRAY is the declaration and the type is derived from it. Written the
 * other way round, `MembershipStatus` and a `ReadonlyArray<MembershipStatus>`
 * are two lists nothing checks against each other — and dropping one entry from
 * the array silently makes {@link decodeMembership} reject a valid row.
 */
export const MEMBERSHIP_STATUSES = [
  "none",
  "active",
  "trialing",
  "past_due",
  "paused",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "canceled",
] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export interface Membership {
  /**
   * The `subscription.plan` value as stored — `string`, NOT a {@link TierId},
   * and named after the column rather than after what it usually means.
   *
   * A row can name a tier this build has never heard of: a stage running an
   * older catalogue, or a tier deleted when it should have been retired. Typing
   * it as `TierId` would make that state unrepresentable in the type and
   * perfectly representable at runtime, which is the worst of both.
   * {@link resolveTier} does the narrowing, and says so.
   */
  readonly plan: string;
  readonly status: MembershipStatus;
  /** End of the paid period, epoch milliseconds. `null` when nothing is running. */
  readonly periodEnd: number | null;
  /** Whether it stops at {@link periodEnd} rather than renewing. */
  readonly cancelAtPeriodEnd: boolean;
}

/**
 * A row as a `subscription` table hands it over — every field `unknown`, because
 * this is the edge where a database and a type meet and the database has never
 * read the type.
 */
export interface SubscriptionRow {
  readonly plan: unknown;
  readonly status: unknown;
  readonly periodEnd: unknown;
  readonly cancelAtPeriodEnd: unknown;
}

/**
 * A row → a {@link Membership}, or `null` for a row this build cannot read.
 *
 * `null` RATHER THAN A GUESS. A status string the catalogue has never seen means
 * Stripe grew a status, and there is no safe way to guess which side of
 * {@link ENTITLING_STATUSES} it falls on — `paused` and `active` are one word
 * apart and opposite in effect. Dropping the row costs a customer their access
 * until this package is updated; guessing could hand out a plan nobody is paying
 * for, which is unbounded.
 */
export const decodeMembership = (row: SubscriptionRow): Membership | null => {
  if (typeof row.plan !== "string" || row.plan === "") return null;
  const status = MEMBERSHIP_STATUSES.find((known) => known === row.status);
  if (status === undefined) return null;

  return {
    plan: row.plan,
    status,
    // `period_end` is `timestamp_ms` in the generated schema, so SQLite hands
    // back a number or nothing at all.
    periodEnd:
      typeof row.periodEnd === "number" && Number.isFinite(row.periodEnd) ? row.periodEnd : null,
    // SQLite has no boolean; the column is an integer, and `0` is false.
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === true || row.cancelAtPeriodEnd === 1,
  };
};

/**
 * The statuses that grant what was paid for.
 *
 * `past_due` IS ON THIS LIST, deliberately. Stripe moves a subscription there on
 * the first failed charge and then retries for days; revoking access at that
 * moment is a support ticket about a card that succeeds on Thursday. `unpaid` is
 * where Stripe puts it once the retries are exhausted, and that one is not here —
 * so the grace period is Stripe's dunning schedule rather than a number invented
 * in this file.
 *
 * `paused`, `incomplete` and `incomplete_expired` are not here either: the first
 * is a subscription the customer asked to stop paying for, and the other two
 * never completed a first payment.
 */
export const ENTITLING_STATUSES: ReadonlyArray<MembershipStatus> = [
  "active",
  "trialing",
  "past_due",
];

/**
 * How long past `periodEnd` a row is still believed.
 *
 * THIS BOUNDS A WEBHOOK OUTAGE. Every status transition reaches this system as a
 * Stripe webhook, so a broken endpoint — a rotated signing secret, a Worker that
 * 500s — freezes every row in whatever state it was last in. Without this,
 * `active` with a `periodEnd` two years in the past still grants everything, and
 * nothing anywhere reports a problem. With it, a stuck row stops entitling a
 * week after the period it was paid for, which is long enough to survive a
 * renewal that lands late and short enough that the failure is noticed.
 */
export const RENEWAL_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether a membership grants anything right now. */
export const entitles = (membership: Membership, now: number): boolean => {
  if (!ENTITLING_STATUSES.includes(membership.status)) return false;
  if (membership.periodEnd === null) return true;
  return membership.periodEnd + RENEWAL_GRACE_MS > now;
};

/**
 * The tier a set of memberships resolves to.
 *
 * TOTAL, and it cannot fail: no memberships, none entitling, or a plan id the
 * catalogue does not recognise all land on {@link BASE_TIER}. A resolver that
 * can throw is a resolver that fails open the first time someone wraps it in a
 * `try`, and the answer to "what may this person do" must never be an exception.
 *
 * Highest rank wins when more than one entitles. The Stripe plugin allows only
 * one active subscription per reference id, so that is defence against a state
 * the payment provider is supposed to prevent rather than a routine case.
 */
export const resolveTier = (memberships: ReadonlyArray<Membership>, now: number): TierId =>
  memberships.reduce<TierId>((best, membership) => {
    if (!entitles(membership, now)) return best;
    const tier = tierIdOf(membership.plan);
    if (tier === null) return best;
    return TIERS[tier].rank > TIERS[best].rank ? tier : best;
  }, BASE_TIER);

/** What a tier buys. */
export const entitlementsOf = (tier: TierId): Entitlements => TIERS[tier].entitlements;

export interface Grant {
  readonly tier: TierId;
  readonly entitlements: Entitlements;
}

/**
 * The one call most code makes: memberships in, capabilities out.
 *
 * ```ts
 * const { entitlements } = grantFor(memberships, Date.now());
 * if (!allows(entitlements, "mezedes.serverCode")) return refuse("upgrade");
 * ```
 *
 * `now` is a parameter rather than a `Date.now()` inside, because a function
 * that reads the clock is not a function you can test at a boundary — and every
 * interesting case here is a boundary.
 */
export const grantFor = (memberships: ReadonlyArray<Membership>, now: number): Grant => {
  const tier = resolveTier(memberships, now);
  return { tier, entitlements: entitlementsOf(tier) };
};
