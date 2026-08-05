/**
 * Cart pricing — the rules, with no database anywhere near them.
 *
 * PRICE AUTHORITY. A price crosses into an order only from the product's ACTIVE
 * RELEASE — never from the draft and never from the client. That rule is
 * enforced by the query that loads these inputs (an INNER JOIN through the
 * active release, so a product without one contributes no pricing row); what
 * lives here is what to DO with them.
 *
 * Money is only added and multiplied by integer quantities here, never divided.
 *
 * Extracted from `Domain/Reservations.ts` unchanged. Its docstring already
 * claimed this was "a pure function of its three arguments — no database, no
 * clock — so every pricing rule is testable without infrastructure". It now is.
 */

export interface CartItem {
  readonly variantId: string;
  readonly quantity: number;
}

export interface OrderLine {
  readonly variantId: string;
  readonly productId: string;
  readonly title: string;
  readonly size: string;
  readonly unitPriceCents: number;
  readonly quantity: number;
  /**
   * Sold against a manufacturing run rather than a shelf.
   *
   * Carried on the line rather than looked up later because it must be SNAPSHOT:
   * the variant flips to `stock` the day the run lands, and what a buyer was told
   * when they paid cannot be allowed to change with it.
   */
  readonly preorder: boolean;
  readonly expectedShipAt: number | null;
}

/**
 * What this store can price, and nothing more.
 *
 * There is no `shippingCents` and no `totalCents` here, and their absence is
 * the design: the price contains shipping, so there is nothing to charge for
 * it, and tax is computed by the provider from the address the buyer types at
 * checkout. Neither is knowable here, so neither is guessed.
 */
export type Totals =
  | {
      readonly ok: true;
      readonly lines: readonly OrderLine[];
      readonly subtotalCents: number;
    }
  | { readonly ok: false; readonly error: string; readonly message?: string };

export interface PricingVariant {
  readonly id: string;
  readonly productId: string;
  readonly size: string;
  readonly stock: number;
  readonly mode: string;
  readonly expectedShipAt: number | null;
}

export interface PricingProduct {
  readonly id: string;
  readonly title: string;
  /**
   * The price in the market the cart is being bought from, or `null` when this
   * release is NOT SOLD THERE — no `product_release_market` row, or one turned
   * off. Null is a real state, not a missing value: it is what makes
   * `market_unavailable` distinguishable from a product that has no active
   * release at all.
   */
  readonly priceCents: number | null;
  readonly status: string;
  readonly preorderCap: number | null;
  readonly preorderClaimed: number;
}

/**
 * A pre-order claim against ONE product's run, summed across its variants.
 *
 * The cap is a product-level fact, so a cart holding two sizes of the same shirt
 * claims two places against one run — and must be guarded once, not twice.
 */
export interface RunClaim {
  readonly productId: string;
  readonly title: string;
  readonly quantity: number;
}

/** Sum the pre-order lines per product. Empty when nothing in the cart is one. */
export const runClaims = (
  lines: readonly Pick<OrderLine, "productId" | "title" | "quantity" | "preorder">[],
): readonly RunClaim[] => {
  const byProduct = new Map<string, RunClaim>();
  for (const line of lines) {
    if (!line.preorder) continue;
    const existing = byProduct.get(line.productId);
    byProduct.set(line.productId, {
      productId: line.productId,
      title: line.title,
      quantity: (existing?.quantity ?? 0) + line.quantity,
    });
  }
  return [...byProduct.values()];
};

/**
 * Validate a cart against the authoritative rows and compute totals.
 *
 * A pure function of its three arguments — no database, no clock — so every
 * pricing rule is testable without infrastructure.
 */
export const computeTotals = (
  items: readonly CartItem[],
  variants: readonly PricingVariant[],
  products: readonly PricingProduct[],
): Totals => {
  if (items.length === 0) return { ok: false, error: "empty_cart" };

  const productById = new Map(products.map((entry) => [entry.id, entry]));
  const variantById = new Map(variants.map((entry) => [entry.id, entry]));

  let subtotalCents = 0;
  const lines: OrderLine[] = [];

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, error: "invalid_quantity", message: item.variantId };
    }
    const variant = variantById.get(item.variantId);
    if (!variant) return { ok: false, error: "variant_not_found", message: item.variantId };
    const owner = productById.get(variant.productId);
    if (!owner || owner.status !== "active") {
      return { ok: false, error: "product_unavailable", message: variant.productId };
    }
    /**
     * ON SALE, BUT NOT HERE. A release with no active row for the buyer's
     * market is a real state — Canada-only is one flipped flag — and it is
     * reported as its own refusal because "unavailable" implies the product is
     * gone when it is merely not sold where the buyer is.
     */
    if (owner.priceCents === null) {
      return { ok: false, error: "market_unavailable", message: owner.title };
    }
    /**
     * ONE CHECK FOR BOTH MODES. `stock` is units on a shelf for a stocked
     * variant and remaining places in a run for a pre-order, and running out
     * means the same thing either way — there is nothing left to sell. The
     * message differs so a buyer is told which it was.
     */
    if (variant.stock < item.quantity) {
      return {
        ok: false,
        error: variant.mode === "preorder" ? "preorder_full" : "out_of_stock",
        message: `${owner.title} (${variant.size})`,
      };
    }
    subtotalCents += owner.priceCents * item.quantity;
    lines.push({
      variantId: variant.id,
      productId: owner.id,
      title: owner.title,
      size: variant.size,
      unitPriceCents: owner.priceCents,
      quantity: item.quantity,
      preorder: variant.mode === "preorder",
      expectedShipAt: variant.expectedShipAt,
    });
  }

  return { ok: true, lines, subtotalCents };
};
