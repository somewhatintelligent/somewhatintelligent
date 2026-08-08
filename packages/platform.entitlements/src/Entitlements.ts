/**
 * WHAT A SUBSCRIPTION BUYS, as a closed, total set of named capabilities.
 *
 * THE ONE RULE THIS PACKAGE EXISTS TO ENFORCE: application code never branches
 * on a plan name. `if (plan === "patron")` is the failure this replaces, and it
 * fails silently — a tier added next month is a tier no `if` chain mentions, so
 * the customer who paid the most gets the least and nothing errors. Code asks
 * for a capability; the catalogue decides which tiers carry it.
 *
 * TOTALITY IS THE MECHANISM. {@link Entitlements} is a mapped type over every
 * key below, so a tier that omits one does not compile. Adding a key is
 * therefore a type error at every tier until each has answered it — which is the
 * only way "the free tier accidentally got the new feature" becomes impossible
 * rather than merely unlikely.
 *
 * NO DEPENDENCIES, deliberately: this is read by Workers, by browser bundles and
 * by the deploy host, and the entitlement question has the same answer in all
 * three. Anything imported here reaches a browser.
 */

/** A capability that is either held or not. */
export type EntitlementKind = "flag" | "quota";

/**
 * How many of a thing may exist. `"unlimited"` rather than `Infinity` because it
 * survives JSON, sorts as a value the reader can see, and cannot be confused
 * with a limit that was computed wrong.
 */
export type Quota = number | "unlimited";

/**
 * EVERY capability the platform sells, and its shape.
 *
 * Namespaced by the system that enforces it, because the product is a registry
 * of systems rather than one application: `systems.*` is whether a system is
 * reachable at all, and `<system>.*` is what may be done inside it. A key with
 * no enforcement site is a lie, so add one only alongside the check that reads
 * it.
 */
export const ENTITLEMENTS = {
  /** Whether the mezedes publishing system is reachable at all. */
  "systems.mezedes": "flag",
  /** Whether systems in private alpha are reachable. */
  "systems.earlyAccess": "flag",
  /** How many mezes may exist at once. */
  "mezedes.mezes": "quota",
  /** Whether a mezes may carry server-side code, which costs an isolate to run. */
  "mezedes.serverCode": "flag",
} as const satisfies Record<string, EntitlementKind>;

export type EntitlementKey = keyof typeof ENTITLEMENTS;

/** The keys answered with a boolean. */
export type FlagKey = {
  [K in EntitlementKey]: (typeof ENTITLEMENTS)[K] extends "flag" ? K : never;
}[EntitlementKey];

/** The keys answered with a {@link Quota}. */
export type QuotaKey = Exclude<EntitlementKey, FlagKey>;

/**
 * A tier's complete answer. TOTAL over {@link ENTITLEMENTS} — see the header:
 * this is what turns a new capability into a compile error rather than a silent
 * `undefined` that reads as "denied" in one place and "allowed" in another.
 */
export type Entitlements = {
  readonly [K in EntitlementKey]: K extends FlagKey ? boolean : Quota;
};

/** Whether a flag is held. */
export const allows = (entitlements: Entitlements, key: FlagKey): boolean =>
  entitlements[key] as boolean;

/** The ceiling on a quota. For display; use {@link within} to decide. */
export const limitOf = (entitlements: Entitlements, key: QuotaKey): Quota =>
  entitlements[key] as Quota;

/**
 * Whether `count` of a thing is permitted.
 *
 * READ IT AS A QUESTION ABOUT THE RESULTING STATE, not the current one — the
 * caller asking whether it may create one more passes `existing + 1`:
 *
 * ```ts
 * if (!within(entitlements, "mezedes.mezes", owned + 1)) return refuse("upgrade");
 * ```
 *
 * The obvious alternative, `used < limit`, was rejected: it reads as "am I under
 * the cap", which is the right question only when exactly one thing is being
 * created, and is off by the batch size the first time anything creates two.
 */
export const within = (entitlements: Entitlements, key: QuotaKey, count: number): boolean => {
  const limit = limitOf(entitlements, key);
  return limit === "unlimited" || count <= limit;
};

/**
 * How many more may be created. `Infinity` for an unlimited quota, and never
 * negative — a customer downgraded below what they already own is over their
 * cap, not owed a negative allowance.
 */
export const remaining = (entitlements: Entitlements, key: QuotaKey, used: number): number => {
  const limit = limitOf(entitlements, key);
  return limit === "unlimited" ? Number.POSITIVE_INFINITY : Math.max(0, limit - used);
};
