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

/** A capability that is either held or not, or one that is counted. */
export type EntitlementKind = "flag" | "quota";

/**
 * How many of a thing may exist. `"unlimited"` rather than `Infinity` because it
 * survives JSON, sorts as a value the reader can see, and cannot be confused
 * with a limit that was computed wrong.
 */
export type Quota = number | "unlimited";

export interface Entitlement {
  readonly kind: EntitlementKind;
  /**
   * What a person is shown. HERE RATHER THAN IN EACH APP: a per-app
   * `Record<EntitlementKey, string>` is total, so adding a key below would break
   * the build of every app that renders the list, each fixing it by writing the
   * same English string. The catalogue already carries a tier's `title` and
   * `summary`; a capability's name is the same kind of fact.
   */
  readonly label: string;
}

/**
 * EVERY capability the platform sells.
 *
 * Namespaced by the system that enforces it, because the product is a registry
 * of systems rather than one application: `systems.*` is whether a system is
 * reachable at all, and `<system>.*` is what may be done inside it. A key with
 * no enforcement site is a lie, so add one only alongside the check that reads
 * it.
 */
export const ENTITLEMENTS = {
  /** Whether the mezedes publishing system is reachable at all. */
  "systems.mezedes": { kind: "flag", label: "Mezedes" },
  /** Whether systems in private alpha are reachable. */
  "systems.earlyAccess": { kind: "flag", label: "Systems in private alpha" },
  /** How many mezes may exist at once. */
  "mezedes.mezes": { kind: "quota", label: "Mezes" },
  /** Whether a mezes may carry server-side code, which costs an isolate to run. */
  "mezedes.serverCode": { kind: "flag", label: "Server-side code in a mezes" },
} as const satisfies Record<string, Entitlement>;

export type EntitlementKey = keyof typeof ENTITLEMENTS;

/** The keys answered with a boolean. */
export type FlagKey = {
  [K in EntitlementKey]: (typeof ENTITLEMENTS)[K]["kind"] extends "flag" ? K : never;
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

/**
 * Which kind a key is, as a TYPE GUARD rather than a comparison.
 *
 * `ENTITLEMENTS[key].kind === "quota"` is a runtime discriminant that cannot
 * narrow `key` itself, so every reader that iterates the catalogue and branches
 * on kind would otherwise need a cast to call {@link limitOf} or {@link allows}.
 * One guard here removes the cast from all of them.
 */
export const isQuotaKey = (key: EntitlementKey): key is QuotaKey =>
  ENTITLEMENTS[key].kind === "quota";

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
