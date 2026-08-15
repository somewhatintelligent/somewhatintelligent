/**
 * The cart's STORAGE half — `localStorage`, quota, and cross-tab events.
 *
 * What a cart IS lives in `src/core/cart.ts` and is pure. This file only moves
 * it in and out of the browser and tells anyone listening that it changed.
 *
 * WHAT IS STORED IS THE WHOLE DESIGN: `{ variantId, quantity }` and nothing
 * more. No prices, no titles, no stock. Checkout re-loads each active release
 * and re-prices the entire cart server-side, so nothing here is ever a
 * transaction input — a hand-edited entry changes what someone sees and never
 * what they are charged. The hint cache beside it is a rendering snapshot, sent
 * nowhere.
 *
 * NO WORKER BINDINGS. This touches `window`, so it may only be imported from a
 * client `<script>` — never from Astro frontmatter, which runs on the server.
 */
import {
  countUnits,
  normalize,
  normalizeHints,
  unheldLines,
  withLine,
  withQuantity,
  withoutLine,
  type CartHint,
  type CartLine,
} from "../core/cart.ts";
import { takeCartParam, writeCartParam } from "../core/cart-link.ts";

export { MAX_QUANTITY, MIN_QUANTITY, type CartHint } from "../core/cart.ts";

const CART_KEY = "si:cart:v1";
const HINTS_KEY = "si:cart:hints:v1";
const CHANGED = "si:cart:changed";

const hasStorage = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

/** Parse a key, or `undefined` when storage is absent or the value is unreadable. */
const readKey = (key: string): unknown => {
  if (!hasStorage()) return undefined;
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

const writeKey = (key: string, value: unknown): void => {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — the in-memory value still stands.
  }
};

const announce = (): void => {
  if (hasStorage()) window.dispatchEvent(new CustomEvent(CHANGED));
};

export const readCart = (): CartLine[] => normalize(readKey(CART_KEY));

const persist = (lines: readonly CartLine[]): CartLine[] => {
  const normalized = normalize(lines);
  writeKey(CART_KEY, normalized);
  announce();
  return normalized;
};

export const readHints = (): Record<string, CartHint> => normalizeHints(readKey(HINTS_KEY));

const writeHint = (variantId: string, hint: CartHint): void => {
  writeKey(HINTS_KEY, { ...readHints(), [variantId]: hint });
};

const removeHint = (variantId: string): void => {
  const hints = readHints();
  if (!(variantId in hints)) return;
  delete hints[variantId];
  writeKey(HINTS_KEY, hints);
};

export const addLine = (variantId: string, quantity = 1, hint?: CartHint): CartLine[] => {
  if (hint) writeHint(variantId, hint);
  return persist(withLine(readCart(), variantId, quantity));
};

export const setQuantity = (variantId: string, quantity: number): CartLine[] =>
  persist(withQuantity(readCart(), variantId, quantity));

export const removeLine = (variantId: string): CartLine[] => {
  removeHint(variantId);
  return persist(withoutLine(readCart(), variantId));
};

export const clearCart = (): void => {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(CART_KEY);
    window.localStorage.removeItem(HINTS_KEY);
  } catch {
    // ignore
  }
  announce();
};

/**
 * THE CART AS IT TRAVELS — both halves of it, because they are one mechanism
 * and neither belongs to the chrome that happens to invoke it.
 *
 * Storage does not cross browsers, so escaping an in-app browser with a bare
 * URL would arrive at an empty cart (see `components/InAppBrowserDialog.astro`
 * for why anyone is escaping). The lines ride in a query parameter instead;
 * the codec and the parameter's name are `core/cart-link.ts`'s, and what is
 * here is the part that needs a `window`.
 *
 * `replaceState` THROUGHOUT, so history gains no entry and back still means
 * back.
 */

/** A cart arriving by link. Call it on any page; it is a no-op without one. */
export const importCartFromUrl = (): void => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const carried = takeCartParam(url);
  if (carried === null) return;
  importCart(carried);
  history.replaceState(history.state, "", url);
};

/**
 * Put the current cart on the page's own URL and hand that URL back — so a
 * caller can swap its scheme without re-parsing, and so EVERY route out of an
 * in-app browser carries the cart: the escape button, the app's own ⋯ menu, a
 * copied link.
 */
export const syncCartToUrl = (): URL => {
  const url = new URL(window.location.href);
  writeCartParam(url, readCart());
  // Nothing to rewrite when the URL already says this — an empty cart on an
  // already-clean address is the common case on a first page.
  if (url.search !== window.location.search) {
    history.replaceState(history.state, "", url);
  }
  return url;
};

/**
 * A cart carried in by link, merged into whatever this browser already holds.
 * `unheldLines` decides what may be added and the incumbent always wins; an
 * empty answer means the link brought nothing new, so nothing is written and
 * no subscriber is woken.
 */
export const importCart = (imported: readonly CartLine[]): CartLine[] => {
  const current = readCart();
  const additions = unheldLines(current, imported);
  if (additions.length === 0) return current;
  return persist([...current, ...additions]);
};

export const cartCount = (): number => countUnits(readCart());

/** In-tab writes and cross-tab `storage` events. Returns an unsubscribe. */
export const subscribeCart = (callback: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  const onChange = (): void => callback();
  const onStorage = (event: StorageEvent): void => {
    if (event.key === CART_KEY || event.key === HINTS_KEY) callback();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
};
