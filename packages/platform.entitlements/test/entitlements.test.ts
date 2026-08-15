/**
 * The resolver, and the four claims the rest of the platform is allowed to
 * assume: it is total, it never fails open, `past_due` keeps its grant, and a
 * frozen row stops granting.
 */
import { describe, expect, test } from "vite-plus/test";

import {
  allows,
  BASE_TIER,
  decodeMembership,
  ENTITLEMENTS,
  isQuotaKey,
  ENTITLING_STATUSES,
  entitlementsOf,
  entitles,
  grantFor,
  limitOf,
  MEMBERSHIP_STATUSES,
  type Membership,
  PURCHASABLE_PLANS,
  RENEWAL_GRACE_MS,
  resolveTier,
  tierIdOf,
  TIERS,
  within,
} from "../src/index.ts";

const NOW = 1_800_000_000_000;
const MONTH = 30 * 24 * 60 * 60 * 1000;

const membership = (over: Partial<Membership> = {}): Membership => ({
  plan: "subscriber",
  status: "active",
  periodEnd: NOW + MONTH,
  cancelAtPeriodEnd: false,
  ...over,
});

describe("the catalogue is total and internally consistent", () => {
  test("every tier answers every entitlement key", () => {
    for (const [id, tier] of Object.entries(TIERS)) {
      for (const key of Object.keys(ENTITLEMENTS)) {
        // `Object.hasOwn` rather than `toHaveProperty`, which reads a dot as a
        // path — every key here has one, so it looked for `entitlements.systems
        // .mezedes` and this assertion could never pass.
        expect(Object.hasOwn(tier.entitlements, key), `${id} is missing ${key}`).toBe(true);
      }
    }
  });

  // The type system enforces this at every tier literal; the runtime check
  // exists because a catalogue loaded from anywhere but this file (a future
  // dynamic plan source) would bypass the type entirely.
  test("no tier answers a key the catalogue does not declare", () => {
    const declared = new Set(Object.keys(ENTITLEMENTS));
    for (const [id, tier] of Object.entries(TIERS)) {
      for (const key of Object.keys(tier.entitlements)) {
        expect(declared.has(key), `${id} answers unknown key ${key}`).toBe(true);
      }
    }
  });

  test("ranks are distinct, so `resolveTier`'s tie-break is never a coin flip", () => {
    const ranks = Object.values(TIERS).map((tier) => tier.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  test("the base tier is rank zero and buys nothing", () => {
    expect(TIERS[BASE_TIER].rank).toBe(0);
    expect(allows(entitlementsOf(BASE_TIER), "systems.mezedes")).toBe(false);
    expect(limitOf(entitlementsOf(BASE_TIER), "mezedes.mezes")).toBe(0);
  });

  test("a purchasable tier prices itself; the base tier does not", () => {
    expect(TIERS[BASE_TIER].prices).toBeNull();
    for (const tier of Object.values(TIERS)) {
      if (tier.purchasable) expect(tier.prices).not.toBeNull();
    }
  });

  test("every offered plan names a lookup key, never a price id", () => {
    expect(PURCHASABLE_PLANS.length).toBeGreaterThan(0);
    for (const plan of PURCHASABLE_PLANS) {
      expect(plan.lookupKey).not.toMatch(/^price_/);
      expect(plan.lookupKey.length).toBeGreaterThan(0);
      expect(tierIdOf(plan.name)).toBe(plan.name);
    }
  });

  test("a retired tier leaves the plan list and keeps resolving", () => {
    const offered = new Set(PURCHASABLE_PLANS.map((plan) => plan.name));
    for (const [id, tier] of Object.entries(TIERS)) {
      expect(offered.has(id)).toBe(tier.purchasable);
      // Whether it is sold has no bearing on whether it is honoured.
      expect(tierIdOf(id)).toBe(id);
    }
  });
});

describe("resolution never fails open", () => {
  // A signed-out visitor and a signed-in account with nothing bought are the
  // same call, which is the point: there is no second code path to forget.
  test("no memberships is the base tier", () => {
    expect(resolveTier([], NOW)).toBe(BASE_TIER);
    expect(grantFor([], NOW).entitlements).toEqual(entitlementsOf(BASE_TIER));
  });

  // The case that motivated `tierIdOf` returning null rather than a cast: a
  // stage running an older catalogue, or a tier that was deleted instead of
  // retired. The customer loses the grant, which is bad — but granting an
  // unknown plan whatever the last-read tier had is worse.
  test("a plan this build has never heard of resolves to the base tier", () => {
    expect(resolveTier([membership({ plan: "enterprise-2029" })], NOW)).toBe(BASE_TIER);
  });

  test("an unknown plan does not suppress a known one alongside it", () => {
    expect(
      resolveTier([membership({ plan: "enterprise-2029" }), membership({ plan: "patron" })], NOW),
    ).toBe("patron");
  });

  test("the highest entitling rank wins", () => {
    expect(
      resolveTier([membership({ plan: "subscriber" }), membership({ plan: "patron" })], NOW),
    ).toBe("patron");
    expect(
      resolveTier([membership({ plan: "patron" }), membership({ plan: "subscriber" })], NOW),
    ).toBe("patron");
  });

  test("a cancelled higher tier does not outrank a live lower one", () => {
    expect(
      resolveTier(
        [membership({ plan: "patron", status: "canceled" }), membership({ plan: "subscriber" })],
        NOW,
      ),
    ).toBe("subscriber");
  });
});

describe("which statuses grant", () => {
  // Iterated, never restated: a fourth copy of the list is a fourth thing to
  // keep in sync, and this one exists precisely to catch the others drifting.
  for (const status of MEMBERSHIP_STATUSES) {
    const expected = ENTITLING_STATUSES.includes(status);
    test(`${status} → ${expected ? "grants" : "does not grant"}`, () => {
      expect(entitles(membership({ status }), NOW)).toBe(expected);
    });
  }

  // Named separately from the table above because it is a product decision
  // rather than a mapping: Stripe retries a failed card for days, and revoking
  // on the first failure is a support ticket about a card that later succeeds.
  test("past_due keeps the grant while Stripe is still retrying", () => {
    expect(resolveTier([membership({ status: "past_due" })], NOW)).toBe("subscriber");
  });

  test("unpaid — where Stripe puts it once retries are exhausted — does not", () => {
    expect(resolveTier([membership({ status: "unpaid" })], NOW)).toBe(BASE_TIER);
  });

  test("a pending cancellation still grants until the period ends", () => {
    expect(resolveTier([membership({ cancelAtPeriodEnd: true })], NOW)).toBe("subscriber");
  });
});

describe("a frozen row stops granting", () => {
  test("inside the renewal grace it is still believed", () => {
    const stale = membership({ periodEnd: NOW - RENEWAL_GRACE_MS + 1000 });
    expect(entitles(stale, NOW)).toBe(true);
  });

  test("past the grace it is not, however `active` it claims to be", () => {
    const frozen = membership({ status: "active", periodEnd: NOW - RENEWAL_GRACE_MS - 1000 });
    expect(entitles(frozen, NOW)).toBe(false);
    expect(resolveTier([frozen], NOW)).toBe(BASE_TIER);
  });

  test("a membership with no period end is not aged out", () => {
    expect(entitles(membership({ periodEnd: null }), NOW + 100 * MONTH)).toBe(true);
  });
});

describe("the checks", () => {
  const subscriber = entitlementsOf("subscriber");
  const patron = entitlementsOf("patron");

  test("a flag reads as held or not", () => {
    expect(allows(subscriber, "systems.mezedes")).toBe(true);
    expect(allows(subscriber, "systems.earlyAccess")).toBe(false);
    expect(allows(patron, "systems.earlyAccess")).toBe(true);
  });

  test("`within` answers about the resulting count, not the current one", () => {
    const limit = limitOf(subscriber, "mezedes.mezes");
    expect(limit).toBe(25);
    // Owning 24 and creating one more is the boundary that an `used < limit`
    // check gets right and a batch of two gets wrong.
    expect(within(subscriber, "mezedes.mezes", 25)).toBe(true);
    expect(within(subscriber, "mezedes.mezes", 26)).toBe(false);
  });

  test("unlimited is unlimited", () => {
    expect(limitOf(patron, "mezedes.mezes")).toBe("unlimited");
    expect(within(patron, "mezedes.mezes", 10_000)).toBe(true);
  });

  // The guard exists so a reader iterating the catalogue can call `limitOf` or
  // `allows` without a cast; if it ever disagreed with `kind`, both would be
  // reachable with the wrong key type.
  test("isQuotaKey agrees with the declared kind for every key", () => {
    for (const key of Object.keys(ENTITLEMENTS) as ReadonlyArray<keyof typeof ENTITLEMENTS>) {
      expect(isQuotaKey(key)).toBe(ENTITLEMENTS[key].kind === "quota");
    }
  });

  test("every capability carries a label a person can read", () => {
    for (const entitlement of Object.values(ENTITLEMENTS)) {
      expect(entitlement.label.trim().length).toBeGreaterThan(0);
    }
  });

  test("a zero quota refuses the first one", () => {
    expect(within(entitlementsOf(BASE_TIER), "mezedes.mezes", 1)).toBe(false);
  });

  // A downgrade leaves a customer over the cap; the check simply refuses the
  // next one rather than pretending the existing rows are gone.
  test("a downgrade that strands existing rows refuses the next one", () => {
    expect(within(subscriber, "mezedes.mezes", 40)).toBe(false);
  });
});

describe("grantFor is the one call most code makes", () => {
  test("it returns the tier and its capabilities together", () => {
    expect(grantFor([membership({ plan: "patron" })], NOW)).toEqual({
      tier: "patron",
      entitlements: entitlementsOf("patron"),
    });
  });

  test("nothing in, base tier out", () => {
    expect(grantFor([], NOW).tier).toBe(BASE_TIER);
  });
});

describe("decoding a row off the subscription table", () => {
  // The shapes are the ones the generated Drizzle schema produces: `period_end`
  // is `timestamp_ms`, so a number; `cancel_at_period_end` is an integer,
  // because SQLite has no boolean.
  const row = {
    plan: "subscriber",
    status: "active",
    periodEnd: NOW + MONTH,
    cancelAtPeriodEnd: 1,
  };

  test("a well-formed row decodes", () => {
    expect(decodeMembership(row)).toEqual({
      plan: "subscriber",
      status: "active",
      periodEnd: NOW + MONTH,
      cancelAtPeriodEnd: true,
    });
  });

  test("SQLite's integer boolean is read as a boolean", () => {
    expect(decodeMembership({ ...row, cancelAtPeriodEnd: 0 })?.cancelAtPeriodEnd).toBe(false);
    expect(decodeMembership({ ...row, cancelAtPeriodEnd: null })?.cancelAtPeriodEnd).toBe(false);
  });

  test("a null period end stays null rather than becoming zero", () => {
    expect(decodeMembership({ ...row, periodEnd: null })?.periodEnd).toBeNull();
  });

  // The whole reason the decoder returns null: `paused` and `active` are one
  // word apart and opposite in effect, so a status Stripe adds later must not be
  // guessed at.
  test("an unrecognised status is refused, not guessed", () => {
    expect(decodeMembership({ ...row, status: "hibernating" })).toBeNull();
  });

  test("a row with no plan is refused", () => {
    expect(decodeMembership({ ...row, plan: "" })).toBeNull();
    expect(decodeMembership({ ...row, plan: null })).toBeNull();
  });

  test("every declared status decodes", () => {
    for (const status of MEMBERSHIP_STATUSES) {
      expect(decodeMembership({ ...row, status })?.status).toBe(status);
    }
  });

  test("a refused row is a dropped grant, never an inherited one", () => {
    const decoded = [{ ...row, status: "hibernating" }, row]
      .map(decodeMembership)
      .filter((m): m is Membership => m !== null);
    expect(decoded).toHaveLength(1);
    expect(resolveTier(decoded, NOW)).toBe("subscriber");
  });
});
