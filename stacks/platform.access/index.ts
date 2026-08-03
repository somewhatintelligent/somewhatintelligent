import * as Alchemy from "alchemy";

/**
 * NOT EXPORTED until something needs to spell it. A consumer gets this shape
 * structurally from `yield* PlatformAccess`; exporting a name with no reader is
 * what fallow reports as a dead type.
 */
interface PlatformAccessRouting {
  /**
   * The reusable staff policy every non-public surface cites — preprod stages,
   * internal tools, unreleased work. One definition, so widening or narrowing
   * who counts as staff is one edit rather than a search.
   */
  readonly staffPolicyId: string;
}

/** `"PlatformAccess"` is the state key. Changing it strands what the old name owns. */
export class PlatformAccess extends Alchemy.Stack<PlatformAccess, PlatformAccessRouting>()(
  "PlatformAccess",
) {}
