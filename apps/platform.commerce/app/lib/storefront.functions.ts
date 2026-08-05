/**
 * What a shopper sees, read from the console.
 *
 * DIFFERENT READS FROM `listProducts` / `getProduct`, and not interchangeable
 * with them. Those are the OPERATOR's view — draft-aware, every status, the
 * unpublished edit included. These two are sourced from the ACTIVE RELEASE
 * alone, which is what makes them worth having: the answer to "is the thing I
 * just published actually on sale, with the right price and the right photo"
 * cannot come from the draft the operator has been editing.
 *
 * Read-only. There is no `placeOrder` here — checkout is what a shopper does,
 * behind its own contract, and an operator surface that could place an order as
 * a customer would file it under an actor that is not the buyer.
 */
import { createServerFn } from "@tanstack/react-start";

import { commerce } from "./commerce.server.ts";
import { requireOperator } from "./server-fn-actor.ts";

/**
 * Previewed in the HOME market. The per-market prices being verified live in
 * the draft editor beside their switches; this answers "is it on sale, with
 * the right photo" for the shop most buyers see.
 */
export const listStorefront = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .handler(async () => commerce().listStorefront("CA"));

export const getStorefrontProduct = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .validator((data: { slug: string }) => data)
  .handler(async ({ data }) => commerce().getStorefrontProduct(data.slug, "CA"));
