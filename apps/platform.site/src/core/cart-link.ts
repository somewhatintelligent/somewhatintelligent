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
 * THE CODEC AND THE PARAMETER, AND NOTHING ELSE. Reading and writing a `URL`
 * is here because both halves of the feature need the same idiom and neither
 * should spell the parameter's name; `history` and `location` belong to
 * `lib/cart.ts`, which owns the browser. Merging two carts is not here at all
 * — that is cart arithmetic and lives in `core/cart.ts` beside the rest of it.
 */
import { normalize, type CartLine } from "./cart.ts";

/** The parameter's name. It should not need to appear anywhere else. */
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
 * the same rules storage gets — the empty-id check, the quantity bounds, the
 * dedupe, `MAX_LINES` — so a link cannot claim a cart storage could not hold.
 */
export const parseCartParam = (value: string): CartLine[] => {
  const entries: { variantId: string; quantity: number }[] = [];
  for (const entry of value.split(",")) {
    const [id, quantity] = entry.split(":");
    try {
      entries.push({ variantId: decodeURIComponent(id ?? ""), quantity: Number(quantity) });
    } catch {
      // One mangled escape is one bad line, not a bad link.
    }
  }
  return normalize(entries);
};

/**
 * Put the cart on a URL, or take it off when there is none to carry. Mutates
 * the `URL` it is handed rather than returning a string, so a caller can go on
 * to read `.href` for a scheme swap without re-parsing.
 */
export const writeCartParam = (url: URL, lines: readonly CartLine[]): void => {
  if (lines.length > 0) url.searchParams.set(CART_PARAM, serializeCart(lines));
  else url.searchParams.delete(CART_PARAM);
};

/**
 * Read the cart off a URL AND STRIP IT, because a URL that kept the parameter
 * would re-import on every reload and shadow every later edit. `null` when
 * there was nothing to take — distinct from a parameter that carried nothing
 * usable, which is an empty cart and still worth stripping.
 */
export const takeCartParam = (url: URL): CartLine[] | null => {
  const carried = url.searchParams.get(CART_PARAM);
  if (carried === null) return null;
  url.searchParams.delete(CART_PARAM);
  return parseCartParam(carried);
};
