/**
 * The markets this store sells into — a TYPED CONSTANT, not a table.
 *
 * There are two, adding a third is a code change you would want reviewed
 * anyway, and a `market` table would be a general-purpose editor for a list
 * that changes once a year. What CANNOT be a constant is the price, because it
 * changes per product and per release: see `product_release_market` in
 * `domain/Schema.ts`, where a row means "sold here, at this" and no row means
 * "not sold here".
 *
 * A market is currency and countries. NOTHING ELSE — no duty rate, no shipping
 * charge, no FX. The system never computes duty and never charges for
 * shipping; the price a market row carries already contains everything, and
 * duty appears only as a recorded actual on the order after fulfilment.
 *
 * `currency` is the minor-unit ISO code every price under this market is
 * quoted in. Prices in different markets are INDEPENDENT numbers, not
 * conversions of one another — the gap between them is a deliberate decision
 * about who absorbs a tariff.
 */
export const MARKETS = {
  CA: { label: "Canada", currency: "cad", shipTo: ["CA"] },
  US: { label: "United States", currency: "usd", shipTo: ["US"] },
} as const;

/** The natural widening of the old `Destination` type, threaded end to end. */
export type MarketCode = keyof typeof MARKETS;

export const MARKET_CODES = Object.keys(MARKETS) as readonly MarketCode[];

export const isMarketCode = (value: string): value is MarketCode => value in MARKETS;
