/**
 * THE SHIPPING AND RETURN POLICY, in the form a machine reads it.
 *
 * THIS IS A MIRROR, NOT A SOURCE. The policy a customer is owed is the prose on
 * `/shipping` and `/refunds`; what is here is the same commitment restated as
 * the numbers `OfferShippingDetails` and `MerchantReturnPolicy` are made of.
 * Editing one of those pages without editing this file publishes a promise to
 * Google that the site does not make to a person — which is worse than
 * publishing nothing, because Google enforces it against the merchant.
 *
 * WHERE THE PROSE IS RICHER THAN THE SCHEMA, THE STRICTER READING WINS. Refunds
 * are generous on a defect (keep the item, refund or replace) and narrow on
 * sizing (exchange only, buyer pays cross-border return postage). Schema.org
 * has one return policy per offer, so the sizing case is the one encoded: never
 * advertise the better half of a policy as if it covered everything.
 */
import type { MarketCode } from "./market.ts";

export interface TransitWindow {
  /** Business days in transit once the parcel is handed over. */
  readonly minDays: number;
  readonly maxDays: number;
}

/** `/shipping`: "Orders are processed within two business days." */
export const HANDLING_DAYS = { minDays: 0, maxDays: 2 } as const;

/**
 * `/shipping`: Canadian orders typically arrive within 3–8 business days of
 * shipping; US orders within 5–12.
 */
export const TRANSIT_DAYS: Record<MarketCode, TransitWindow> = {
  CA: { minDays: 3, maxDays: 8 },
  US: { minDays: 5, maxDays: 12 },
};

/**
 * `/shipping`: "Shipping is included in the price. There is no shipping line at
 * checkout." Zero is therefore the true rate rather than a placeholder — and
 * saying so is worth more than omitting it, because Google renders a known-free
 * shipping cost in the listing and treats an absent one as unknown.
 */
export const SHIPPING_RATE_MINOR_UNITS = 0;

/** `/refunds`: "Say something within 30 days of delivery". */
export const RETURN_WINDOW_DAYS = 30;

/** The markets shipped to at all. `/shipping`: "We ship to Canada and the United States." */
export const SHIPPING_COUNTRIES: readonly MarketCode[] = ["CA", "US"];
