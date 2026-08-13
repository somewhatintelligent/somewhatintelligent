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
  withLine,
  withQuantity,
  withoutLine,
  type CartHint,
  type CartLine,
} from "../core/cart.ts";
import { mergeImported } from "../core/cart-link.ts";

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
 * A cart carried in by LINK — the in-app-browser escape hatch arriving. The
 * merge semantics live in `core/cart-link.ts` and only fill gaps; this
 * persists only when something new landed, so reloading an already-imported
 * link moves nothing and announces nothing.
 */
export const importCart = (imported: readonly CartLine[]): CartLine[] => {
  const current = readCart();
  const merged = mergeImported(current, imported);
  // `mergeImported` only appends, so an unchanged length is an unchanged cart.
  if (merged.length === current.length) return current;
  return persist(merged);
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
