/**
 * THE CART AS A QUERY PARAMETER — the escape hatch's luggage.
 *
 * In-app browsers (Instagram's, Facebook's) are a separate browser with
 * separate storage: a cart built inside one does not exist in the phone's real
 * browser, so "open this in your real browser" would arrive empty-handed. The
 * link carries the cart instead.
 *
 * ONLY `{ variantId, quantity }` TRAVELS — the same two fields storage holds,
 * for the same reason: nothing in a URL is a transaction input. Checkout
 * re-prices everything from the active release, so the worst a hand-edited
 * link can do is fill a cart with things the shop actually sells, at the price
 * it actually charges. The hints (titles, prices, images) deliberately stay
 * behind: they are a rendering cache, and a line without one still renders and
 * still checks out.
 *
 * PURE, like `core/cart.ts` — the URL and `history` belong to whoever calls.
 */
import { normalize, withLine, type CartLine } from "./cart.ts";

/** The parameter's name, shared by the writer (the in-app note) and the reader (the header). */
export const CART_PARAM = "cart";

/**
 * `id:qty,id:qty`. `encodeURIComponent` escapes both delimiters wherever they
 * occur inside a variant id, which is what makes the format unambiguous
 * without a real parser.
 */
export const serializeCart = (lines: readonly CartLine[]): string =>
  lines.map((line) => `${encodeURIComponent(line.variantId)}:${line.quantity}`).join(",");

/**
 * Total: garbage in, empty cart out, never a throw. A mangled percent-escape
 * throws in `decodeURIComponent`, so each entry decodes inside its own guard
 * and one bad line drops without voiding the rest. `normalize` then applies
 * the same clamps storage gets — quantity bounds, dedupe, `MAX_LINES` — so a
 * link cannot claim a cart storage could not hold.
 */
export const parseCartParam = (value: string): CartLine[] => {
  const entries: { variantId: string; quantity: number }[] = [];
  for (const entry of value.split(",")) {
    const [id, quantity] = entry.split(":");
    if (!id) continue;
    try {
      entries.push({ variantId: decodeURIComponent(id), quantity: Number(quantity) });
    } catch {
      // One mangled escape is one bad line, not a bad link.
    }
  }
  return normalize(entries);
};

/**
 * FILL THE GAPS, TOUCH NOTHING HELD. The live cart is the shopper's own and
 * newer than any link, so a variant the cart already holds keeps its quantity
 * — an import must not double a line someone has since adjusted. Only variants
 * the cart does not hold come across, through `withLine` so the line cap
 * holds.
 */
export const mergeImported = (
  current: readonly CartLine[],
  imported: readonly CartLine[],
): CartLine[] => {
  let merged = [...current];
  for (const line of imported) {
    if (merged.some((held) => held.variantId === line.variantId)) continue;
    merged = withLine(merged, line.variantId, line.quantity);
  }
  return merged;
};
