/**
 * Who did a thing, derived from the subject namespace rather than guessed.
 *
 * Every actor subject is minted server-side with a namespace prefix — the edge
 * mints `operator:<sub>` after an identity check, the storefront mints
 * `customer:<email>` around whatever the shopper typed. A caller cannot choose
 * the prefix, which is what makes the namespaces non-forgeable and what lets
 * this classification be trusted.
 */

export const OPERATOR_PREFIX = "operator:";
export const CUSTOMER_PREFIX = "customer:";

export type ActorKind = "operator" | "customer";

/**
 * Classify a command-ledger row by its actor.
 *
 * ANYTHING UNRECOGNISED IS A CUSTOMER. The two namespaces are exhaustive today,
 * and an unknown prefix means a subject this code did not mint — attributing
 * that to staff would be the failure this function exists to prevent, so it
 * fails toward the lower claim.
 */
export const actorKind = (actorSub: string): ActorKind =>
  actorSub.startsWith(OPERATOR_PREFIX) ? "operator" : "customer";
