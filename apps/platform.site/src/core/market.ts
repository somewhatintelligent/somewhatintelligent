/**
 * The shopper's market — WHICH SHOP THEY ARE IN, not just where a cart ships.
 *
 * It decides which prices every page renders, what currency checkout charges
 * in, and the one country the payment page's address form accepts. Commerce is
 * the authority on what each market costs; this module only remembers which
 * one the shopper picked.
 *
 * A COOKIE, because the choice has to be visible to server rendering — the
 * shop pages price their markup on the server, so `localStorage` (invisible in
 * frontmatter) cannot carry it. `parseMarket` is total: any tampered or stale
 * value is the home market, never an error.
 */
export type MarketCode = "CA" | "US";

export const MARKET_COOKIE = "si_market";

export const HOME_MARKET: MarketCode = "CA";

export const MARKET_LABELS: Record<MarketCode, string> = {
  CA: "Canada · CAD",
  US: "United States · USD",
};

export const parseMarket = (value: unknown): MarketCode => (value === "US" ? "US" : HOME_MARKET);
