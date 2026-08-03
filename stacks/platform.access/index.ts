import * as Alchemy from "alchemy";

/**
 * NOT EXPORTED until something needs to spell it. A consumer gets this shape
 * structurally from `yield* PlatformAccess`; exporting a name with no reader is
 * what fallow reports as a dead type.
 */
interface PlatformAccessRouting {
  /**
   * THE staff policy — one per account, not one per stage. It gates a preprod
   * deployment of a public app and the prod deployment of an internal one
   * alike, so consumers pin to the single deployment rather than resolving
   * their own stage:
   *
   *     yield* PlatformAccess.stage[PRODUCTION_STAGE]
   */
  readonly staffPolicyId: string;
}

/** `"PlatformAccess"` is the state key. Changing it strands what the old name owns. */
export class PlatformAccess extends Alchemy.Stack<PlatformAccess, PlatformAccessRouting>()(
  "PlatformAccess",
) {}
