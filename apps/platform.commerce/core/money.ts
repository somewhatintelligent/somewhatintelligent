/**
 * How money is represented, in one place.
 *
 * Integer MINOR UNITS everywhere — in every column and every DTO. There is no
 * decimal or float type anywhere in the schema.
 *
 * Three consequences the rest of the store depends on:
 *
 *  - Money is only ever added and multiplied by integer quantities, never
 *    divided, so no rounding error can accumulate: `subtotal += price * qty`.
 *  - Division by 100 happens exactly once, at display time, which is a
 *    presentation concern and lives with the UI rather than here.
 *  - {@link isNonNegativeInt} re-checks at the RPC boundary so a bad price or
 *    stock surfaces as `invalid_price` / `invalid_stock` rather than as a CHECK
 *    violation from D1.
 *
 * WHAT THIS MODULE NO LONGER DOES: compute shipping, or compute tax.
 *
 * Both are now the payment provider's, and that is a deliberate transfer of
 * authority rather than a convenience. Tax owed on a Canadian order depends on
 * the buyer's province, on registration thresholds, and on rules that change
 * without asking us; shipping depends on a rate the buyer picks at checkout.
 * Anything computed here would be a second opinion that has to agree forever
 * with the number actually charged — and when the two disagree, the charge wins
 * and the books are simply wrong.
 *
 * So this store prices LINE ITEMS and nothing else. Shipping and tax arrive back
 * from the settled payment. See `customerOrder.shippingCents`.
 */

/**
 * Cart subtotal at or above which the store eats the shipping.
 *
 * Still ours, because it is a PROMOTION rather than a calculation — we choose
 * which rate to attach to the checkout, and Stripe charges whatever we attach.
 */
export const FREE_SHIPPING_THRESHOLD_CENTS = 7_500;

export const qualifiesForFreeShipping = (subtotalCents: number): boolean =>
  subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS;

export const isNonNegativeInt = (value: number): boolean => Number.isInteger(value) && value >= 0;

/**
 * The garment scale, in wearing order rather than alphabetical — XS before S,
 * L before XL. Anything outside this list sorts after all of it, and ties break
 * LEXICOGRAPHICALLY: `"10"` lands before `"9"`, and so does `"11"`, which
 * numeric ordering would not do. That is fine for the labels this store uses
 * and would not be if numeric sizes ever became real.
 */
export const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;

export const sortBySize = <T extends { size: string }>(rows: readonly T[]): T[] => {
  const rank = (size: string) => {
    const index = SIZE_ORDER.indexOf(size as (typeof SIZE_ORDER)[number]);
    return index === -1 ? SIZE_ORDER.length : index;
  };
  return [...rows].sort((a, b) => rank(a.size) - rank(b.size) || a.size.localeCompare(b.size));
};
