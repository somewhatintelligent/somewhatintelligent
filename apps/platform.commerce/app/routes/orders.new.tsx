/**
 * RECORD AN ORDER THAT WAS PAID ELSEWHERE — an e-transfer, cash at a stall, a
 * card terminal.
 *
 * The result is an ordinary paid order: it takes its units off the shelf (or
 * its places in a pre-order run) through the same guards checkout uses, lands
 * in the ready-to-ship queue and the fulfilment demand, and is shipped from its
 * own page like any other.
 *
 * WHAT THE OPERATOR TYPES THAT A SHOPPER NEVER DOES: the price actually
 * charged per unit, and the shipping and tax actually collected. Prices are
 * PREFILLED from the product's price in the chosen market, because that is
 * what most sales are; they are editable because a record of money that has
 * already moved has to say how much moved. The total is shown, never typed —
 * Commerce computes it from the parts.
 *
 * Every rule is Commerce's. This page does not check stock before sending: a
 * shelf that is short comes back as `out_of_stock` and is rendered as such.
 */
import { useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import { Button } from "platform.ui/components/button";
import { Field, FieldDescription } from "platform.ui/components/field";
import { Input } from "platform.ui/components/input";
import { Label } from "platform.ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "platform.ui/components/select";

import { MARKET_CODES, MARKETS, type MarketCode } from "../../core/markets.ts";
import type { ProductDetail, ProductDraftDTO } from "../../domain/Contracts.ts";
import { Facts, PageHeader, Section } from "../components/page.tsx";
import { Hint, Outcome } from "../components/outcome.tsx";
import { DataTable, Td, type Column } from "../components/table.tsx";
import { getProduct, listProducts } from "../lib/catalog.functions.ts";
import { recordExternalOrder } from "../lib/orders.functions.ts";
import { centsFrom, commandId, dollarsFrom, money, refusalText } from "../lib/format.ts";

/**
 * Suggestions, not a list: the domain takes any method, and a fixed set here
 * would be a second place to edit the first time someone pays another way.
 */
const METHODS = ["e-transfer", "cash", "card terminal", "paypal", "cheque"];

const LINE_COLUMNS: Column[] = [
  { label: "Product" },
  { label: "Size" },
  { label: "Qty", align: "right" },
  { label: "Unit price", align: "right" },
  { label: "Line", align: "right" },
  { label: "" },
];

interface Line {
  /** React's key only; never sent. */
  key: string;
  productId: string;
  variantId: string;
  quantity: string;
  price: string;
  /** Once typed into, a price is the operator's and a market change leaves it alone. */
  priceEdited: boolean;
}

const blankLine = (): Line => ({
  key: crypto.randomUUID(),
  productId: "",
  variantId: "",
  quantity: "1",
  price: "",
  priceEdited: false,
});

const blankAddress = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postal: "",
  phone: "",
};

/** The draft's price in a market, as the text a price input shows — or blank when it has none. */
const listPrice = (detail: ProductDetail | undefined, market: MarketCode): string => {
  const row = detail?.markets.find((entry) => entry.market === market);
  return row ? dollarsFrom(row.priceCents) : "";
};

export const Route = createFileRoute("/orders/new")({
  /**
   * EVERY product, following the cursor. The read is capped per page, and a
   * picker that silently stopped at the cap would make the hundred-and-first
   * product unsellable by hand with nothing saying why.
   */
  loader: async () => {
    const products: ProductDraftDTO[] = [];
    let cursor: string | undefined;
    do {
      const page = await listProducts({
        data: { status: "all", limit: 100, ...(cursor ? { cursor } : {}) },
      });
      if (!page.ok) return page;
      products.push(...page.value.products);
      cursor = page.value.nextCursor ?? undefined;
    } while (cursor);
    return { ok: true as const, value: products };
  },
  component: RecordOrder,
});

function RecordOrder() {
  const result = Route.useLoaderData();
  const navigate = useNavigate();
  const products = result.ok ? result.value : [];

  const [market, setMarket] = useState<MarketCode>("CA");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState(blankAddress);
  const [country, setCountry] = useState<MarketCode>("CA");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [payment, setPayment] = useState({ method: "e-transfer", reference: "" });
  const [charges, setCharges] = useState({ shipping: "0.00", tax: "0.00" });

  /** Variants and market prices, fetched once per product the first time it is picked. */
  const [details, setDetails] = useState<Record<string, ProductDetail>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  /**
   * ONE RETRY KEY PER ATTEMPT TO RECORD THIS ORDER, held across a network
   * failure so a resend replays rather than recording twice. Replaced after a
   * REFUSAL, because the ledger keeps a refused key's answer: once the stock is
   * corrected, the same key would only replay `out_of_stock`.
   */
  const intent = useRef(commandId());

  const currency = MARKETS[market].currency;
  const updateLine = (key: string, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const pickProduct = async (key: string, productId: string) => {
    const known = details[productId];
    updateLine(key, {
      productId,
      variantId: "",
      price: listPrice(known, market),
      priceEdited: false,
    });
    if (known) return;
    try {
      const fetched = await getProduct({ data: { productId } });
      if (!fetched.ok) {
        setError(new Error(refusalText(fetched.error, fetched.message)));
        return;
      }
      setDetails((current) => ({ ...current, [productId]: fetched.value }));
      setLines((current) =>
        current.map((line) =>
          line.key === key && line.productId === productId && !line.priceEdited
            ? { ...line, price: listPrice(fetched.value, market) }
            : line,
        ),
      );
    } catch (cause) {
      setError(cause);
    }
  };

  /**
   * A new market re-prices every line the operator has not typed a price into,
   * and moves the address to that market's country — both still editable.
   */
  const pickMarket = (next: MarketCode) => {
    setMarket(next);
    setCountry(next);
    setLines((current) =>
      current.map((line) =>
        line.priceEdited ? line : { ...line, price: listPrice(details[line.productId], next) },
      ),
    );
  };

  const cents = (text: string) => centsFrom(text) ?? 0;
  const subtotalCents = lines.reduce(
    (total, line) => total + cents(line.price) * (Number.parseInt(line.quantity, 10) || 0),
    0,
  );
  const totalCents = subtotalCents + cents(charges.shipping) + cents(charges.tax);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const recorded = await recordExternalOrder({
        data: {
          market,
          email,
          shipping: {
            name: address.name,
            line1: address.line1,
            ...(address.line2.trim() ? { line2: address.line2 } : {}),
            city: address.city,
            region: address.region,
            postal: address.postal,
            country,
            ...(address.phone.trim() ? { phone: address.phone } : {}),
          },
          /**
           * A price that does not parse goes as -1, not as zero, so Commerce
           * refuses it with `invalid_amount` rather than recording a free sale
           * nobody agreed to.
           */
          items: lines
            .filter((line) => line.variantId !== "")
            .map((line) => ({
              variantId: line.variantId,
              quantity: Number(line.quantity),
              unitPriceCents: centsFrom(line.price) ?? -1,
            })),
          shippingCents: centsFrom(charges.shipping) ?? -1,
          taxCents: centsFrom(charges.tax) ?? -1,
          payment: {
            method: payment.method,
            ...(payment.reference.trim() ? { reference: payment.reference } : {}),
          },
          commandId: intent.current,
        },
      });
      if (!recorded.ok) {
        intent.current = commandId();
        setError(new Error(refusalText(recorded.error, recorded.message)));
        return;
      }
      await navigate({
        to: "/orders/$orderNumber",
        params: { orderNumber: recorded.value.orderNumber },
      });
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const ready =
    email.trim() !== "" &&
    payment.method.trim() !== "" &&
    lines.some((line) => line.variantId !== "");

  return (
    <>
      <PageHeader
        back={
          <Button
            variant="outline"
            size="icon-sm"
            nativeButton={false}
            aria-label="Back to orders"
            render={<Link to="/orders" search={{ status: "paid" }} />}
          >
            <ArrowLeft className="size-4" />
          </Button>
        }
        title="Record an order"
        subtitle="For a sale paid outside checkout. It is written in as paid, and its stock is taken now."
      />

      {result.ok ? null : <Outcome error={new Error(refusalText(result.error, result.message))} />}

      <form onSubmit={submit} className="flex flex-col gap-4">
        <Section
          title="In the box"
          description="Prices are prefilled from the product's price in the market. Enter what was actually charged."
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((current) => [...current, blankLine()])}
            >
              <Plus />
              Add item
            </Button>
          }
        >
          <DataTable columns={LINE_COLUMNS}>
            {lines.map((line) => {
              const detail = details[line.productId];
              const quantity = Number.parseInt(line.quantity, 10) || 0;
              return (
                <tr key={line.key}>
                  <Td className="min-w-52">
                    <Select
                      value={line.productId || null}
                      onValueChange={(next) => next && void pickProduct(line.key, next)}
                    >
                      <SelectTrigger className="w-full" aria-label="Product">
                        <SelectValue placeholder="Choose a product">
                          {(value: string | null) =>
                            products.find((entry) => entry.productId === value)?.title ??
                            "Choose a product"
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((entry) => (
                          <SelectItem key={entry.productId} value={entry.productId}>
                            {entry.title}
                            {entry.status === "active" ? "" : ` · ${entry.status}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Td>
                  <Td className="min-w-44">
                    <Select
                      value={line.variantId || null}
                      disabled={detail === undefined}
                      onValueChange={(next) => next && updateLine(line.key, { variantId: next })}
                    >
                      <SelectTrigger className="w-full" aria-label="Size">
                        <SelectValue placeholder="Size">
                          {(value: string | null) =>
                            detail?.variants.find((variant) => variant.id === value)?.size ?? "Size"
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {(detail?.variants ?? []).map((variant) => (
                          <SelectItem key={variant.id} value={variant.id}>
                            {variant.size} ·{" "}
                            {variant.mode === "preorder"
                              ? `pre-order, ${variant.stock} places`
                              : `${variant.stock} on hand`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Td>
                  <Td align="right">
                    <Input
                      aria-label="Quantity"
                      type="number"
                      min={1}
                      step={1}
                      className="ml-auto w-20 text-right"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    />
                  </Td>
                  <Td align="right">
                    <Input
                      aria-label="Unit price"
                      inputMode="decimal"
                      className="ml-auto w-28 text-right"
                      value={line.price}
                      placeholder="0.00"
                      onChange={(e) =>
                        updateLine(line.key, { price: e.target.value, priceEdited: true })
                      }
                    />
                  </Td>
                  <Td align="right">{money(cents(line.price) * quantity, currency)}</Td>
                  <Td align="right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove item"
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((current) => current.filter((entry) => entry.key !== line.key))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Buyer" description="Who paid, and where it ships.">
            <div className="flex flex-col gap-4">
              <Field>
                <Label htmlFor="buyer-email">Email</Label>
                <Input
                  id="buyer-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="buyer@example.com"
                  required
                />
                <FieldDescription>
                  The buyer can look the order up on the storefront with this address.
                </FieldDescription>
              </Field>
              <Field>
                <Label htmlFor="ship-name">Name</Label>
                <Input
                  id="ship-name"
                  value={address.name}
                  onChange={(e) => setAddress({ ...address, name: e.target.value })}
                  required
                />
              </Field>
              <Field>
                <Label htmlFor="ship-line1">Street</Label>
                <Input
                  id="ship-line1"
                  value={address.line1}
                  onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                  required
                />
              </Field>
              <Field>
                <Label htmlFor="ship-line2">Unit, suite</Label>
                <Input
                  id="ship-line2"
                  value={address.line2}
                  onChange={(e) => setAddress({ ...address, line2: e.target.value })}
                  placeholder="Optional"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <Label htmlFor="ship-city">City</Label>
                  <Input
                    id="ship-city"
                    value={address.city}
                    onChange={(e) => setAddress({ ...address, city: e.target.value })}
                    required
                  />
                </Field>
                <Field>
                  <Label htmlFor="ship-region">Province / state</Label>
                  <Input
                    id="ship-region"
                    value={address.region}
                    onChange={(e) => setAddress({ ...address, region: e.target.value })}
                    required
                  />
                </Field>
                <Field>
                  <Label htmlFor="ship-postal">Postal / ZIP</Label>
                  <Input
                    id="ship-postal"
                    value={address.postal}
                    onChange={(e) => setAddress({ ...address, postal: e.target.value })}
                    required
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <Label htmlFor="ship-country">Country</Label>
                  <Select
                    value={country}
                    onValueChange={(next) => next && setCountry(next as MarketCode)}
                  >
                    <SelectTrigger id="ship-country" className="w-full">
                      <SelectValue>
                        {(value: MarketCode) => MARKETS[value]?.label ?? value}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {MARKET_CODES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {MARKETS[code].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <Label htmlFor="ship-phone">Phone</Label>
                  <Input
                    id="ship-phone"
                    type="tel"
                    value={address.phone}
                    onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                    placeholder="Optional"
                  />
                </Field>
              </div>
            </div>
          </Section>

          <Section title="Payment" description="How the money arrived, and how much of it.">
            <div className="flex flex-col gap-4">
              <Field>
                <Label htmlFor="market">Market</Label>
                <Select
                  value={market}
                  onValueChange={(next) => next && pickMarket(next as MarketCode)}
                >
                  <SelectTrigger id="market" className="w-full">
                    <SelectValue>
                      {(value: MarketCode) =>
                        MARKETS[value]
                          ? `${MARKETS[value].label} · ${MARKETS[value].currency.toUpperCase()}`
                          : value
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MARKET_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {MARKETS[code].label} · {MARKETS[code].currency.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Decides the currency every amount is in.</FieldDescription>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <Label htmlFor="method">Paid by</Label>
                  <Input
                    id="method"
                    list="payment-methods"
                    value={payment.method}
                    onChange={(e) => setPayment({ ...payment, method: e.target.value })}
                    required
                  />
                  <datalist id="payment-methods">
                    {METHODS.map((method) => (
                      <option key={method} value={method} />
                    ))}
                  </datalist>
                </Field>
                <Field>
                  <Label htmlFor="reference">Reference</Label>
                  <Input
                    id="reference"
                    value={payment.reference}
                    onChange={(e) => setPayment({ ...payment, reference: e.target.value })}
                    placeholder="Confirmation number"
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <Label htmlFor="shipping-charged">Shipping charged</Label>
                  <Input
                    id="shipping-charged"
                    inputMode="decimal"
                    value={charges.shipping}
                    onChange={(e) => setCharges({ ...charges, shipping: e.target.value })}
                  />
                </Field>
                <Field>
                  <Label htmlFor="tax-collected">Tax collected</Label>
                  <Input
                    id="tax-collected"
                    inputMode="decimal"
                    value={charges.tax}
                    onChange={(e) => setCharges({ ...charges, tax: e.target.value })}
                  />
                </Field>
              </div>
              <Facts
                rows={[
                  ["Subtotal", money(subtotalCents, currency)],
                  ["Shipping", money(cents(charges.shipping), currency)],
                  ["Tax", money(cents(charges.tax), currency)],
                  ["Total", <strong key="total">{money(totalCents, currency)}</strong>],
                ]}
              />
              <Hint>
                The total should match what you received. It is computed from the lines above, so a
                discount belongs in the unit price.
              </Hint>
            </div>
          </Section>
        </div>

        <Outcome error={error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !ready}>
            {busy ? "Recording…" : "Record paid order"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            nativeButton={false}
            render={<Link to="/orders" search={{ status: "paid" }} />}
          >
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
