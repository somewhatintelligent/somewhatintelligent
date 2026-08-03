/**
 * Whether one variant can be bought right now.
 *
 * ONE RULE, IN ONE PLACE, and it did not exist before. `Storefront.ts` and
 * `Catalog.ts` each answered this question with `stock > 0` and neither
 * consulted the pre-order run — so a product whose run was fully subscribed
 * advertised every size as buyable and then refused at the reservation guard.
 * Two contract comments and a console hint all promised the opposite.
 *
 * THE RULE IS THE GUARDS, RESTATED. A sale has to pass both conditional
 * UPDATEs in `Reservations.ts`: the per-variant decrement, and — for a
 * pre-order line only — the run claim, which additionally requires the cap to
 * exist. Anything this function says is available must survive both, or the
 * storefront is lying.
 *
 * Pure, so `core/`: no database, no clock. That is what lets the property tests
 * assert "advertised implies purchasable" without a deployment.
 */

export interface AvailabilityInputs {
  /** Units this variant may still sell. */
  readonly stock: number;
  /** `"stock"` or `"preorder"` — which counters a sale has to pass. */
  readonly mode: string;
  /** The product's run ceiling. `null` means the product is not sold as a run. */
  readonly runCap: number | null;
  /** Places already sold against that run. */
  readonly runClaimed: number;
}

export const isAvailable = ({ stock, mode, runCap, runClaimed }: AvailabilityInputs): boolean => {
  if (stock <= 0) return false;

  /**
   * A stocked variant never touches the run — `runClaims` emits a claim only
   * for lines marked `preorder`, so the run guard is not in its path at all.
   */
  if (mode !== "preorder") return true;

  /**
   * A pre-order variant under a product with NO CAP is unbuyable, and reporting
   * it as unavailable is the honest answer rather than a defensive one: the run
   * guard requires `preorder_cap IS NOT NULL`, so every checkout for it fails
   * with `preorder_full` forever. Refusing to advertise it is the least this
   * can do; `publishProduct` and `setProductStatus` refuse to let a product
   * reach that shape in the first place.
   */
  return runCap !== null && runClaimed < runCap;
};
