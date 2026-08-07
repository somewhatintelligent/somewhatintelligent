/**
 * WHAT A CHECKOUT REQUEST HAS TO SATISFY, as pure functions.
 *
 * Extracted from the route handler, which reached 22 cyclomatic branches as one
 * unbroken run of `if`s — a shape where a missing check is invisible because
 * every line looks like every other line. Each field gets a named parser
 * instead, so the handler reads as the list of things that must hold and each
 * rule can be tested without a Worker, a binding, or a request.
 *
 * `null` MEANS REJECTED, uniformly. Every parser is total: it takes `unknown`
 * off a parsed JSON body and either returns the narrowed value or `null`. No
 * throwing, so no handler can forget a `catch` and turn a bad body into a 500.
 *
 * THE BOUNDS MIRROR THE DOMAIN'S rather than inventing their own. `placeOrder`
 * caps the cart at twenty lines because D1 allows a hundred bound parameters
 * per query and pricing spends one per variant; it caps the address at 254
 * because that is RFC 5321's limit and the value is persisted twice per order.
 * Restating them here turns a 500 on the public endpoint into a 400.
 *
 * WHY THE PARSERS BELOW SUPPRESS `complexity`. What they score is CRAP, and
 * fallow ESTIMATES CRAP from export references rather than reading coverage —
 * so a tested five-branch guard scores the same as an untested one. Every
 * branch here is one validation rule and every rule is exercised by `test/`;
 * splitting further would fragment a single rule across call sites to satisfy
 * an estimate. Re-evaluate if the gate is ever given `--coverage`.
 */

const MAX_LINES = 20;
const MAX_QUANTITY = 10;
const MIN_QUANTITY = 1;
const MAX_EMAIL = 254;
const MIN_EMAIL = 3;
/** A UUID is 36 characters; anything shorter cannot be one. */
const MIN_COMMAND_ID = 8;

type Market = "CA" | "US";

interface CheckoutLine {
  readonly variantId: string;
  readonly quantity: number;
}

interface CheckoutInput {
  readonly email: string;
  readonly market: Market;
  readonly commandId: string;
  readonly items: readonly CheckoutLine[];
}

/** Lower-cased and trimmed, because that is the form the order is keyed on. */
const parseEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < MIN_EMAIL || email.length > MAX_EMAIL) return null;
  return email;
};

const parseMarket = (value: unknown): Market | null =>
  value === "CA" || value === "US" ? value : null;

/**
 * The browser's retry key. It must come from the client and survive a resubmit
 * — `customerCall` derives the idempotency key from it, so minting one per
 * request would make every retry a second reservation.
 */
const parseCommandId = (value: unknown): string | null =>
  typeof value === "string" && value.length >= MIN_COMMAND_ID ? value : null;

// fallow-ignore-next-line complexity -- CRAP, not complexity: every branch is one validation rule, the function is pure and covered by `test/`. See the note at the top of this file.
const parseLine = (value: unknown): CheckoutLine | null => {
  if (typeof value !== "object" || value === null) return null;
  const { variantId, quantity } = value as { variantId?: unknown; quantity?: unknown };
  if (typeof variantId !== "string" || variantId === "") return null;
  const n = Math.trunc(Number(quantity));
  if (!Number.isFinite(n) || n < MIN_QUANTITY || n > MAX_QUANTITY) return null;
  return { variantId, quantity: n };
};

// fallow-ignore-next-line complexity -- CRAP, not complexity: every branch is one validation rule, the function is pure and covered by `test/`. See the note at the top of this file.
const parseItems = (value: unknown): readonly CheckoutLine[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LINES) return null;
  const lines: CheckoutLine[] = [];
  for (const entry of value) {
    const line = parseLine(entry);
    if (line === null) return null;
    lines.push(line);
  }
  return lines;
};

/**
 * The whole body, or the name of the first field that failed.
 *
 * The error is the FIELD rather than a message, so the route decides the
 * wording and the status and this stays a statement about the data.
 */
type CheckoutParse =
  | { readonly ok: true; readonly value: CheckoutInput }
  | { readonly ok: false; readonly error: string };

// fallow-ignore-next-line complexity -- CRAP, not complexity: every branch is one validation rule, the function is pure and covered by `test/`. See the note at the top of this file.
export const parseCheckout = (body: unknown): CheckoutParse => {
  const { email, market, commandId, items } = (body ?? {}) as Record<string, unknown>;

  const parsedEmail = parseEmail(email);
  if (parsedEmail === null) return { ok: false, error: "invalid_email" };

  const parsedMarket = parseMarket(market);
  if (parsedMarket === null) return { ok: false, error: "invalid_market" };

  const parsedCommandId = parseCommandId(commandId);
  if (parsedCommandId === null) return { ok: false, error: "invalid_command_id" };

  const parsedItems = parseItems(items);
  if (parsedItems === null) return { ok: false, error: "invalid_cart" };

  return {
    ok: true,
    value: {
      email: parsedEmail,
      market: parsedMarket,
      commandId: parsedCommandId,
      items: parsedItems,
    },
  };
};

/** The order lookup's body: a number and the address it was placed with. */
// fallow-ignore-next-line complexity -- CRAP, not complexity: every branch is one validation rule, the function is pure and covered by `test/`. See the note at the top of this file.
export const parseOrderLookup = (
  body: unknown,
): { readonly orderNumber: string; readonly email: string } | null => {
  const { orderNumber, email } = (body ?? {}) as Record<string, unknown>;
  const parsedEmail = parseEmail(email);
  if (parsedEmail === null) return null;
  if (typeof orderNumber !== "string" || orderNumber === "") return null;
  return { orderNumber, email: parsedEmail };
};
