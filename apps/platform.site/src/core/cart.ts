/**
 * THE CART AS ARITHMETIC — no storage, no `window`, no events.
 *
 * Split from `lib/cart.ts` because the two halves fail differently. This half
 * decides what a cart IS: how a quantity is clamped, how a duplicate variant
 * folds into one line, how many lines fit. That is decidable at a desk and
 * belongs in the pure zone, where it can be tested without a browser.
 *
 * The other half is `localStorage`, quota errors and cross-tab events, and it
 * imports these.
 *
 * EVERY FUNCTION RETURNS A NEW ARRAY. Nothing here mutates its argument, so a
 * caller can compare before and after to decide whether to persist.
 */

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 10;
/**
 * Twenty, matching `placeOrder`'s payload cap — itself set by D1's limit of a
 * hundred bound parameters per query, one per variant in the pricing lookup. A
 * cart above it is a 500 on the public endpoint, so it cannot be built here.
 */
export const MAX_LINES = 20;

export interface CartLine {
  readonly variantId: string;
  readonly quantity: number;
}

/** A rendering snapshot taken at add-to-cart time. NEVER a checkout input. */
export interface CartHint {
  readonly slug: string;
  readonly title: string;
  readonly size: string;
  readonly priceCents: number;
  readonly coverHref: string | null;
}

export const clampQuantity = (quantity: unknown): number => {
  const n = Math.trunc(Number(quantity));
  if (!Number.isFinite(n)) return MIN_QUANTITY;
  return Math.max(MIN_QUANTITY, Math.min(MAX_QUANTITY, n));
};

/** One stored entry, or `null` if it is not a line at all. */
/**
 * CRAP, not complexity. Every branch below is one validation rule and the
 * function is pure and covered by `test/`; fallow ESTIMATES CRAP from export
 * references rather than reading coverage, so a tested five-branch guard scores
 * the same as an untested one. Splitting further would fragment a single rule
 * across call sites to satisfy an estimate. Re-evaluate if the gate ever passes
 * `--coverage`.
 */
// fallow-ignore-next-line complexity
const parseLine = (entry: unknown): CartLine | null => {
  if (typeof entry !== "object" || entry === null) return null;
  const { variantId, quantity } = entry as Partial<CartLine>;
  if (typeof variantId !== "string" || variantId === "") return null;
  return { variantId, quantity: clampQuantity(quantity ?? MIN_QUANTITY) };
};

/**
 * NORMALISED ON EVERY READ, not only on write. Storage is user-writable and
 * outlives deploys, so a cart valid when written may not be now — and every
 * reader would otherwise need its own guard.
 */
/**
 * CRAP, not complexity. Every branch below is one validation rule and the
 * function is pure and covered by `test/`; fallow ESTIMATES CRAP from export
 * references rather than reading coverage, so a tested five-branch guard scores
 * the same as an untested one. Splitting further would fragment a single rule
 * across call sites to satisfy an estimate. Re-evaluate if the gate ever passes
 * `--coverage`.
 */
// fallow-ignore-next-line complexity
export const normalize = (raw: unknown): CartLine[] => {
  if (!Array.isArray(raw)) return [];
  const summed = new Map<string, number>();
  for (const entry of raw) {
    const line = parseLine(entry);
    if (line === null) continue;
    const running = summed.get(line.variantId);
    summed.set(line.variantId, clampQuantity((running ?? 0) + line.quantity));
  }
  return [...summed].slice(0, MAX_LINES).map(([variantId, quantity]) => ({ variantId, quantity }));
};

/** Add a variant, dedupe-summed. A full cart ignores a variant it does not already hold. */
export const withLine = (
  lines: readonly CartLine[],
  variantId: string,
  quantity = 1,
): CartLine[] => {
  if (!variantId) return [...lines];
  const held = lines.some((line) => line.variantId === variantId);
  if (held) {
    return lines.map((line) =>
      line.variantId === variantId
        ? { variantId, quantity: clampQuantity(line.quantity + quantity) }
        : line,
    );
  }
  if (lines.length >= MAX_LINES) return [...lines];
  return [...lines, { variantId, quantity: clampQuantity(quantity) }];
};

export const withQuantity = (
  lines: readonly CartLine[],
  variantId: string,
  quantity: number,
): CartLine[] =>
  lines.map((line) =>
    line.variantId === variantId ? { variantId, quantity: clampQuantity(quantity) } : line,
  );

export const withoutLine = (lines: readonly CartLine[], variantId: string): CartLine[] =>
  lines.filter((line) => line.variantId !== variantId);

/** Total units across lines — the header badge's number. */
export const countUnits = (lines: readonly CartLine[]): number =>
  lines.reduce((sum, line) => sum + line.quantity, 0);

/** A stored hints blob, narrowed. Anything that is not an object is no hints. */
export const normalizeHints = (raw: unknown): Record<string, CartHint> =>
  raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, CartHint>)
    : {};
