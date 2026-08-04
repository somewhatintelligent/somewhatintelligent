/**
 * The commerce binding, typed — and the ONLY module that holds the stub.
 *
 * `toRpcAsync` recovers the method shapes from the Worker class itself, so
 * every call is checked against what `workers/CommerceSurface.ts` actually
 * implements rather than against an interface restating it here. Same bridge
 * the operator console uses, for the same reason.
 *
 * `typeof CommerceWorker`, not `CommerceWorker` — `Rpc.Shape` unwraps the CLASS
 * VALUE's type (which extends `Effect<Worker & Rpc<Shape>>`); the instance type
 * is not the Effect and recovers nothing.
 *
 * TWO METHODS ARE RE-EXPORTED and there is no passthrough, which is the whole
 * discipline: the binding grants the entire surface, so what keeps a public
 * site off `deleteProduct` is that nothing outside this file can name the stub.
 *
 * `cloudflare:workers` rather than `Astro.locals.runtime.env`: that getter was
 * removed in Astro v6+ / `@astrojs/cloudflare` v14 and throws. `env` is read
 * inside each call rather than at module scope, so importing this at build
 * time — when no binding exists — is harmless.
 */
import { env } from "cloudflare:workers";
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";

import { customerCall } from "platform.commerce/contracts";
import type { ProductCardDTO, StorefrontProductDTO } from "platform.commerce/contracts";
import type CommerceWorker from "platform.commerce/workers/Commerce";

/**
 * The DTOs come FROM commerce rather than being restated here. They are derived
 * from the same `effect/Schema` structs the surface returns, so a field added,
 * renamed or dropped there is a type error in the view rather than a blank cell
 * on a live page.
 */
export type { ProductCardDTO, StorefrontProductDTO };

const commerce = () => toRpcAsync<typeof CommerceWorker>(env.COMMERCE);

/**
 * Every product with an active release, title-ordered.
 *
 * A product with no active release contributes NO row — the same fail-closed
 * rule checkout applies when it prices a cart, so this cannot advertise
 * something checkout would refuse to sell.
 */
export const listStorefront = (): Promise<readonly ProductCardDTO[]> => commerce().listStorefront();

/**
 * One product by slug, matched on the RELEASE's slug rather than the identity
 * row — renaming a slug in a draft must not break the URL of what is currently
 * published. `null` when nothing active answers to it.
 */
export const getStorefrontProduct = (slug: string): Promise<StorefrontProductDTO | null> =>
  commerce().getStorefrontProduct(slug);

/**
 * BUY A CART. The one write this site can reach, and the only one it ever will.
 *
 * `customerCall` mints the envelope a guest gets: the subject is derived from
 * the address (`customer:<email>`), which is the only stable owner an anonymous
 * order has. It also derives the idempotency key from `commandId`, which is
 * what makes a double-submitted form a REPLAY rather than a second reservation
 * — so the id must come from the browser and survive a resubmit, never be
 * minted per request here.
 *
 * PRICES ARE NOT ACCEPTED. Only variant ids and quantities cross; the active
 * release is the price authority and Commerce re-prices the whole cart.
 *
 * `destination` is required BEFORE the payment page opens, because it fixes the
 * shipping rate and pins the address form to one country. Stripe cannot infer
 * it from an address the buyer has not typed yet.
 */
export const placeOrder = (input: {
  email: string;
  destination: "CA" | "US";
  commandId: string;
  items: readonly { variantId: string; quantity: number }[];
}) => {
  const email = input.email.trim().toLowerCase();
  return commerce().placeOrder(
    customerCall(email, input.commandId, {
      email,
      customerId: `customer:${email}`,
      destination: input.destination,
      items: input.items.map((item) => ({ ...item })),
    }),
  );
};

/**
 * A customer's own order.
 *
 * THE EMAIL IS REQUIRED AND IT IS NOT A CONVENIENCE. Order numbers are derived
 * from an id tail and get quoted in receipts and support threads, so on their
 * own they are a guessable, shareable handle — a lookup keyed on the number
 * alone hands out the order book to anyone willing to enumerate. Commerce
 * enforces the match itself and answers a mismatch with the same `not_found` a
 * nonexistent order gets, so the response never confirms a number is real.
 *
 * PROJECTED, not forwarded. The operator view carries the internal customer id,
 * product and variant ids and a fulfilment note; a customer gets what is on
 * their receipt.
 */
export const getMyOrder = async (orderNumber: string, email: string) => {
  const result = await commerce().getCustomerOrder(orderNumber, email.trim().toLowerCase());
  if (!result.ok) return null;
  const order = result.value;
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    currency: order.currency,
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    shippedAt: order.shippedAt,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      title: item.title,
      size: item.size,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      preorder: item.preorder,
      expectedShipAt: item.expectedShipAt,
    })),
  };
};
