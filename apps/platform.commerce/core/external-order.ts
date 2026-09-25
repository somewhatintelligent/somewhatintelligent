/**
 * An order PAID ELSEWHERE — the rules, with no database anywhere near them.
 *
 * Checkout prices a cart; this RECORDS a sale that has already happened. The
 * buyer paid by e-transfer, in cash, on a card terminal — somewhere this system
 * never saw — and an operator is writing down what was received. That one
 * difference decides every rule below that departs from `pricing.ts`:
 *
 *  - THE PRICE IS THE OPERATOR'S. Checkout's price authority is the active
 *    release, because a shopper must not choose what they pay. Here nobody is
 *    choosing: the money has already moved, and the order has to say how much
 *    moved or the books disagree with the bank. Each line carries the unit
 *    price actually charged, and the command ledger records who asserted it.
 *  - SHIPPING AND TAX ARE KNOWN. On a checkout they do not exist until the
 *    provider settles them; here the operator was there when they were
 *    charged, so the total is complete the moment the order is written.
 *  - NO STATUS OR MARKET GATE. A withdrawn product with units still on the
 *    shelf can be sold by hand, and a sale in person has no storefront market
 *    to be refused by. What stays is everything that protects INVENTORY — the
 *    variant must exist, the shelf or the run must hold the units — because a
 *    sale recorded against stock that is not there is an oversell whichever
 *    door it came through.
 *
 * Money is only added and multiplied by integer quantities, as everywhere else.
 */
import { isNonNegativeInt } from "./money.ts";
import type { OrderLine } from "./pricing.ts";

export interface ExternalItem {
  readonly variantId: string;
  readonly quantity: number;
  /** Minor units ACTUALLY CHARGED per unit, after whatever was agreed. */
  readonly unitPriceCents: number;
}

export interface ExternalVariant {
  readonly id: string;
  readonly productId: string;
  readonly size: string;
  readonly stock: number;
  readonly mode: string;
  readonly expectedShipAt: number | null;
}

export interface ExternalProduct {
  readonly id: string;
  /** The live release's title, or the draft's when nothing has been published. */
  readonly title: string;
  readonly preorderCap: number | null;
}

export type ExternalOrderError =
  | "empty_order"
  | "invalid_quantity"
  | "invalid_amount"
  | "invalid_email"
  | "invalid_address"
  | "missing_payment_method"
  | "variant_not_found"
  | "out_of_stock"
  | "preorder_full"
  | "preorder_cap_missing";

export type ExternalTotals =
  | {
      readonly ok: true;
      readonly lines: readonly OrderLine[];
      readonly subtotalCents: number;
      readonly shippingCents: number;
      readonly taxCents: number;
      /**
       * COMPUTED, never supplied. A total typed beside the parts it sums is a
       * second opinion that can disagree with them, and a discount belongs in
       * the unit price it discounted rather than in an unexplained gap.
       */
      readonly totalCents: number;
    }
  | { readonly ok: false; readonly error: ExternalOrderError; readonly message?: string };

/**
 * The address the order is filed under, as `getCustomerOrder` will compare it.
 *
 * Normalised the way the storefront normalises a checkout — trimmed and
 * lowercased — so a buyer who looks up an order an operator recorded finds it
 * with the same address they would have typed at checkout. `null` when it is
 * not shaped like an address at all: a typo here is an order its buyer can
 * never open, and the operator is the only one who can catch it.
 */
export const normaliseEmail = (email: string): string | null => {
  const normalised = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(normalised) ? normalised : null;
};

/**
 * Where the parcel goes. Structural rather than imported, because `core/` may
 * not reach into `domain/` — `ShippingAddress` satisfies it.
 */
export interface ExternalAddress {
  readonly name: string;
  readonly line1: string;
  readonly line2?: string | undefined;
  readonly city: string;
  readonly region: string;
  readonly postal: string;
  readonly country: "CA" | "US";
  readonly phone?: string | undefined;
}

/**
 * The address, trimmed, or `null` when a line a label needs is blank.
 *
 * A checkout's address is whatever the provider collected; this one is typed
 * by hand, and a stray space is a string the schema accepts. The order reader
 * treats an address with a blank core line as NO address, so writing one would
 * produce a paid order the console says has nowhere to go. Optional lines that
 * are blank are dropped rather than stored empty.
 */
export const normaliseAddress = (address: ExternalAddress): ExternalAddress | null => {
  const required = {
    name: address.name.trim(),
    line1: address.line1.trim(),
    city: address.city.trim(),
    region: address.region.trim(),
    postal: address.postal.trim(),
  };
  if (Object.values(required).some((value) => value === "")) return null;
  const line2 = address.line2?.trim();
  const phone = address.phone?.trim();
  return {
    ...required,
    ...(line2 ? { line2 } : {}),
    country: address.country,
    ...(phone ? { phone } : {}),
  };
};

/**
 * How the money was taken, trimmed. `null` when there is no method — the one
 * fact that separates a recorded payment from an unexplained `paid`.
 */
export const normalisePayment = (payment: {
  readonly method: string;
  readonly reference?: string | undefined;
}): { readonly method: string; readonly reference: string | null } | null => {
  const method = payment.method.trim();
  if (method === "") return null;
  return { method, reference: payment.reference?.trim() || null };
};

/**
 * Validate an externally-paid order against the authoritative variant rows and
 * compute its totals.
 *
 * A pure function of its arguments — no database, no clock. The stock checks
 * here are an EARLY ANSWER, not the guard: the conditional UPDATEs that reserve
 * the units are what actually decide, exactly as they do for checkout.
 */
export const priceExternalOrder = (
  order: {
    readonly items: readonly ExternalItem[];
    readonly shippingCents: number;
    readonly taxCents: number;
  },
  variants: readonly ExternalVariant[],
  products: readonly ExternalProduct[],
): ExternalTotals => {
  if (order.items.length === 0) return { ok: false, error: "empty_order" };
  if (!isNonNegativeInt(order.shippingCents)) {
    return { ok: false, error: "invalid_amount", message: "shipping" };
  }
  if (!isNonNegativeInt(order.taxCents)) {
    return { ok: false, error: "invalid_amount", message: "tax" };
  }

  const variantById = new Map(variants.map((entry) => [entry.id, entry]));
  const productById = new Map(products.map((entry) => [entry.id, entry]));

  let subtotalCents = 0;
  const lines: OrderLine[] = [];

  for (const item of order.items) {
    const variant = variantById.get(item.variantId);
    const owner = variant ? productById.get(variant.productId) : undefined;
    if (!variant || !owner) {
      return { ok: false, error: "variant_not_found", message: item.variantId };
    }
    /**
     * Named the way the operator picked it, not by id: these are refusals of
     * something they typed, and "which line" is the whole of what they need.
     */
    const label = `${owner.title} (${variant.size})`;
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { ok: false, error: "invalid_quantity", message: label };
    }
    if (!isNonNegativeInt(item.unitPriceCents)) {
      return { ok: false, error: "invalid_amount", message: label };
    }

    const preorder = variant.mode === "preorder";
    /**
     * A pre-order line claims a place in its product's run, and the run guard
     * matches nothing while the cap is null — so without this the operator
     * would be told the run is FULL when it was never opened.
     */
    if (preorder && owner.preorderCap === null) {
      return { ok: false, error: "preorder_cap_missing", message: owner.title };
    }
    if (variant.stock < item.quantity) {
      return { ok: false, error: preorder ? "preorder_full" : "out_of_stock", message: label };
    }

    subtotalCents += item.unitPriceCents * item.quantity;
    lines.push({
      variantId: variant.id,
      productId: owner.id,
      title: owner.title,
      size: variant.size,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      preorder,
      expectedShipAt: variant.expectedShipAt,
    });
  }

  return {
    ok: true,
    lines,
    subtotalCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: subtotalCents + order.shippingCents + order.taxCents,
  };
};
