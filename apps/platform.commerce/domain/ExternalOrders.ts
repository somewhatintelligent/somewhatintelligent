/**
 * Orders PAID ELSEWHERE — an e-transfer, cash at a market stall, a card
 * terminal — written into the book by the operator who took the money.
 *
 * Checkout is not the only way a shop gets paid, and until this existed an
 * order paid any other way could not be entered at all: it never reached the
 * ready-to-ship queue, never counted toward fulfilment demand, and its units
 * stayed on sale to the next shopper. The only workaround was `adjustStock`,
 * which fixes the count and records nothing about who bought what.
 *
 * WHAT IS SHARED WITH CHECKOUT, AND WHY. The reservation — the ledger claim,
 * the per-variant and per-run guards, the compensation when one loses, the
 * release marker — is `Checkout.reserve`, called unchanged. A sale recorded by
 * hand takes units off the same shelf a shopper is buying from at the same
 * moment, so it must lose to them the same way and unwind the same way.
 *
 * WHAT IS NOT. There is no payment session, so nothing waits on a webhook: the
 * order is marked `paid` in the same commit that completes the ledger. And the
 * amounts are the operator's — see `core/external-order.ts` for why the price
 * authority that governs checkout does not govern a record of money that has
 * already moved.
 *
 * WHO DID IT. The command ledger records the OPERATOR as the actor — someone in
 * this business chose to write this order — while the order itself is filed
 * under the BUYER's customer subject, so they can look it up with their own
 * address exactly as if they had checked out.
 */
import { eq, inArray } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { CoreOutcome } from "../services/Audit.ts";
import { Database, query, type DbStatement } from "../services/Database.ts";
import { Ids } from "../services/Ids.ts";
import { CUSTOMER_PREFIX } from "../core/actors.ts";
import {
  normaliseAddress,
  normaliseEmail,
  normalisePayment,
  priceExternalOrder,
} from "../core/external-order.ts";
import { MARKETS } from "../core/markets.ts";
import { orderNumberFor, reserve } from "./Checkout.ts";
import {
  err,
  ok,
  type ExternalOrderError,
  type RecordExternalOrderInput,
  type RecordedOrderDTO,
} from "./Contracts.ts";
import { customerOrder, product, productDraft, productRelease, productVariant } from "./Schema.ts";

/**
 * The variants being sold and the products that own them.
 *
 * NOT `loadPricingInputs`. That query inner-joins through the active release
 * and the buyer's market because checkout must refuse anything not on sale
 * there; a sale that already happened has nothing to be refused by. The title
 * is the live release's where there is one — what a shopper would have seen —
 * and the draft's otherwise, so a product sold before it was ever published
 * still snapshots a name.
 */
const loadLines = Effect.fn("ExternalOrders.loadLines")(function* (variantIds: readonly string[]) {
  const { db } = yield* Database;
  if (variantIds.length === 0) return { variants: [], products: [] };

  const variants = yield* query(() =>
    db
      .select({
        id: productVariant.id,
        productId: productVariant.productId,
        size: productVariant.size,
        stock: productVariant.stock,
        mode: productVariant.mode,
        expectedShipAt: productVariant.expectedShipAt,
      })
      .from(productVariant)
      .where(inArray(productVariant.id, [...new Set(variantIds)])),
  );

  const productIds = [...new Set(variants.map((variant) => variant.productId))];
  if (productIds.length === 0) return { variants, products: [] };

  const rows = yield* query(() =>
    db
      .select({
        id: product.id,
        releaseTitle: productRelease.title,
        draftTitle: productDraft.title,
        preorderCap: product.preorderCap,
      })
      .from(product)
      .innerJoin(productDraft, eq(productDraft.productId, product.id))
      .leftJoin(productRelease, eq(productRelease.id, product.activeReleaseId))
      .where(inArray(product.id, productIds)),
  );

  return {
    variants,
    products: rows.map((row) => ({
      id: row.id,
      title: row.releaseTitle ?? row.draftTitle,
      preorderCap: row.preorderCap,
    })),
  };
});

/**
 * Record an order that was paid outside checkout: validate it, reserve its
 * stock, write it, and mark it paid.
 *
 * Runs under `Audit.claimed` rather than `Audit.command` for the reason
 * checkout does — the reservation has to commit, and be inspected, before the
 * outcome is known — and puts the claim in the reservation's own batch, so a
 * double-submitted form reserves once.
 */
export const recordExternalOrder = Effect.fn("ExternalOrders.recordExternalOrder")(function* (
  input: RecordExternalOrderInput,
  claim: DbStatement,
): Effect.fn.Return<CoreOutcome<RecordedOrderDTO, ExternalOrderError>, never, Database | Ids> {
  const { db } = yield* Database;
  const ids = yield* Ids;

  /**
   * The hand-typed fields first, and without echoing them back: a refusal is
   * written to the ledger, and a mistyped address is nothing it needs to keep.
   */
  const email = normaliseEmail(input.email);
  if (email === null) return { failure: err("invalid_email") };
  const shipping = normaliseAddress(input.shipping);
  if (shipping === null) return { failure: err("invalid_address") };
  const payment = normalisePayment(input.payment);
  if (payment === null) return { failure: err("missing_payment_method") };

  const { variants, products } = yield* loadLines(input.items.map((item) => item.variantId));
  const totals = priceExternalOrder(input, variants, products);
  if (!totals.ok) return { failure: err(totals.error, totals.message) };

  const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
  const orderId = yield* ids.next();
  const itemIds = yield* ids.many(totals.lines.length);
  const orderNumber = orderNumberFor(orderId);
  const currency = MARKETS[input.market].currency;

  const refused = yield* reserve(
    claim,
    {
      id: orderId,
      orderNumber,
      /** The BUYER's subject, spelled exactly as the storefront spells it. */
      userId: `${CUSTOMER_PREFIX}${email}`,
      email,
      /**
       * UNPAID until the reservation is known good, like every order `reserve`
       * writes. The flip to `paid` below commits with the ledger's completion,
       * so a process that dies in between leaves a pending order with no
       * session — which the orphan sweep cancels and releases.
       */
      paymentStatus: "unpaid",
      externalPaymentMethod: payment.method,
      externalPaymentReference: payment.reference,
      /**
       * ALL FOUR, and final. On a checkout these wait for the provider; here the
       * operator was there when they were charged.
       */
      subtotalCents: totals.subtotalCents,
      shippingCents: totals.shippingCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      currency,
      shipCountry: shipping.country,
      shipName: shipping.name,
      shipLine1: shipping.line1,
      shipLine2: shipping.line2 ?? null,
      shipCity: shipping.city,
      shipRegion: shipping.region,
      shipPostal: shipping.postal,
      shipPhone: shipping.phone ?? null,
      createdAt: now,
      updatedAt: now,
    },
    totals.lines,
    itemIds,
  );
  if (refused) return { failure: refused };

  return {
    statements: [
      db
        .update(customerOrder)
        .set({ status: "paid", paymentStatus: "paid", updatedAt: now })
        .where(eq(customerOrder.id, orderId)) as unknown as DbStatement,
    ],
    response: ok({ orderNumber, totalCents: totals.totalCents, currency }),
    facts: {
      targetType: "order",
      targetId: orderNumber,
      /**
       * The reference is recorded here as well as on the row: this is the
       * answer to "who said this was paid, and on what evidence", and the
       * ledger is the copy nobody edits.
       */
      detail: {
        external: true,
        method: payment.method,
        ...(payment.reference ? { reference: payment.reference } : {}),
        market: input.market,
        lines: totals.lines.length,
        totalCents: totals.totalCents,
        preorder: totals.lines.some((line) => line.preorder),
      },
    },
  };
});
