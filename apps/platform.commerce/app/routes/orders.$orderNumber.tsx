/**
 * ONE ORDER — the receipt, the address, what to put in the box, and the two
 * transitions an operator drives.
 *
 * THE TRANSITIONS ARE THE DOMAIN'S. Fulfilling an unpaid order is refused with
 * `payment_incomplete`; an already-shipped order refuses with
 * `already_fulfilled`. This page does not pre-empt those with disabled buttons,
 * because a disabled button is a second copy of a rule that drifts — it sends
 * the call and renders what came back.
 *
 * The timeline is the reason `source` exists: it separates what a PERSON did
 * from what the payment provider REPORTED. An audit trail that conflates the
 * two cannot answer the question it exists for.
 */
import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { Button } from "platform.ui/components/button";
import { Field } from "platform.ui/components/field";
import { Input } from "platform.ui/components/input";
import { Label } from "platform.ui/components/label";
import { Separator } from "platform.ui/components/separator";

import type { OrderDetailDTO } from "../../domain/Contracts.ts";
import { Empty, Facts, PageHeader, Section } from "../components/page.tsx";
import { Hint, Outcome } from "../components/outcome.tsx";
import { OrderStatusBadge, PaymentBadge } from "../components/badges.tsx";
import { DataTable, Td, type Column } from "../components/table.tsx";
import {
  fulfillOrder,
  getOrder,
  markDelivered,
  orderTimeline,
  setOrderStatus,
} from "../lib/orders.functions.ts";
import { commandId, money, refusalText, when } from "../lib/format.ts";

/**
 * The carriers this shop actually uses, as a datalist rather than a select —
 * the domain takes any string, and a fixed list here would be a second place to
 * edit when a new one is used once.
 */
const CARRIERS = ["canada-post", "ups", "fedex", "purolator", "dhl"];

const ITEM_COLUMNS: Column[] = [
  { label: "Item" },
  { label: "Size" },
  { label: "Qty", align: "right" },
  { label: "Unit", align: "right" },
  { label: "Line", align: "right" },
];

type Timeline = Awaited<ReturnType<typeof orderTimeline>> | null;

export const Route = createFileRoute("/orders/$orderNumber")({
  loader: async ({ params }) => {
    const [order, timeline] = await Promise.all([
      getOrder({ data: { orderNumber: params.orderNumber } }),
      /** A read that records nothing; a failure here must not hide the order. */
      orderTimeline({ data: { orderNumber: params.orderNumber } }).catch(() => null),
    ]);
    return { order, timeline };
  },
  component: OrderRoute,
});

function OrderRoute() {
  const { order: result, timeline } = Route.useLoaderData();
  const { orderNumber } = Route.useParams();

  if (!result.ok) {
    return (
      <>
        <PageHeader title={orderNumber} />
        <Outcome error={new Error(refusalText(result.error, result.message))} />
      </>
    );
  }

  const order = result.value;

  return (
    <>
      <PageHeader
        title={order.orderNumber}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} />
            <PaymentBadge status={order.paymentStatus} />
            <span>{order.email}</span>
            <span>· placed {when(order.createdAt)}</span>
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Receipt order={order} />
        <ShipTo shipping={order.shipping} />
      </div>

      <LineItems order={order} />
      <Fulfilment order={order} />
      <TimelineSection entries={timeline} />
    </>
  );
}

// ── Receipt ──────────────────────────────────────────────────────────────────

function Receipt({ order }: { order: OrderDetailDTO }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Subtotal", money(order.subtotalCents, order.currency)],
    ["Shipping", money(order.shippingCents, order.currency)],
    ["Tax", money(order.taxCents, order.currency)],
    ["Total", <strong key="total">{money(order.totalCents, order.currency)}</strong>],
  ];
  if (order.refundedCents > 0) {
    rows.push(["Refunded", money(order.refundedCents, order.currency)]);
  }
  rows.push(["Payment session", order.sessionId ?? "none"]);
  if (order.receiptEmail && order.receiptEmail !== order.email) {
    rows.push(["Receipt email", order.receiptEmail]);
  }

  return (
    <Section title="Receipt">
      <Facts rows={rows} />
      <Hint>
        Shipping and tax are zero until the order is paid — they do not exist before the payment
        page settles them.
      </Hint>
    </Section>
  );
}

function ShipTo({ shipping }: { shipping: OrderDetailDTO["shipping"] }) {
  return (
    <Section title="Ship to">
      {shipping ? (
        <address className="text-sm not-italic">
          <div className="font-medium">{shipping.name}</div>
          <div>{shipping.line1}</div>
          {shipping.line2 ? <div>{shipping.line2}</div> : null}
          <div>
            {shipping.city}, {shipping.region} {shipping.postal}
          </div>
          <div>{shipping.country}</div>
          {shipping.phone ? (
            <div className="mt-1 text-muted-foreground">{shipping.phone}</div>
          ) : null}
        </address>
      ) : (
        <Empty>No address yet — it arrives with the payment.</Empty>
      )}
    </Section>
  );
}

function LineItems({ order }: { order: OrderDetailDTO }) {
  return (
    <Section
      title="In the box"
      description={`${order.items.length} line item${order.items.length === 1 ? "" : "s"}`}
    >
      <DataTable columns={ITEM_COLUMNS}>
        {order.items.map((item, index) => (
          <tr key={`${item.variantId}-${index}`}>
            <Td>
              {item.title}
              {item.preorder ? (
                <span className="ml-2 text-xs text-warning">
                  pre-order
                  {item.expectedShipAt ? ` · ships ${when(item.expectedShipAt)}` : ""}
                </span>
              ) : null}
            </Td>
            <Td>{item.size}</Td>
            <Td align="right">{item.quantity}</Td>
            <Td align="right">{money(item.unitPriceCents, order.currency)}</Td>
            <Td align="right">{money(item.unitPriceCents * item.quantity, order.currency)}</Td>
          </tr>
        ))}
      </DataTable>
    </Section>
  );
}

// ── Fulfilment ───────────────────────────────────────────────────────────────

function Fulfilment({ order }: { order: OrderDetailDTO }) {
  const router = useRouter();
  const orderNumber = order.orderNumber;

  const [ship, setShip] = useState({ carrier: "canada-post", trackingNumber: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (
    call: () => Promise<{ ok: true } | { ok: false; error: string; message?: string }>,
    success: string,
  ) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const outcome = await call();
      if (!outcome.ok) {
        setError(new Error(refusalText(outcome.error, outcome.message)));
        return;
      }
      setDone(success);
      await router.invalidate();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Fulfilment" description="Carrier and tracking move the order to shipped.">
      <div className="flex flex-col gap-4">
        {order.trackingNumber ? <Shipment order={order} /> : null}

        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-44">
            <Label htmlFor="carrier">Carrier</Label>
            <Input
              id="carrier"
              list="carriers"
              value={ship.carrier}
              onChange={(e) => setShip({ ...ship, carrier: e.target.value })}
            />
            <datalist id="carriers">
              {CARRIERS.map((carrier) => (
                <option key={carrier} value={carrier} />
              ))}
            </datalist>
          </Field>
          <Field className="w-56">
            <Label htmlFor="tracking">Tracking number</Label>
            <Input
              id="tracking"
              value={ship.trackingNumber}
              onChange={(e) => setShip({ ...ship, trackingNumber: e.target.value })}
            />
          </Field>
          <Field className="min-w-52 flex-1">
            <Label htmlFor="note">Note</Label>
            <Input
              id="note"
              value={ship.note}
              onChange={(e) => setShip({ ...ship, note: e.target.value })}
              placeholder="Optional"
            />
          </Field>
          <Button
            disabled={busy || !ship.trackingNumber}
            onClick={() =>
              void run(
                () =>
                  fulfillOrder({
                    data: {
                      orderNumber,
                      carrier: ship.carrier,
                      trackingNumber: ship.trackingNumber,
                      ...(ship.note ? { note: ship.note } : {}),
                      commandId: commandId(),
                    },
                  }),
                "Marked shipped",
              )
            }
          >
            Mark shipped
          </Button>
        </div>

        <Separator />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(
                () => markDelivered({ data: { orderNumber, commandId: commandId() } }),
                "Marked delivered",
              )
            }
          >
            Mark delivered
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  setOrderStatus({
                    data: { orderNumber, status: "paid", commandId: commandId() },
                  }),
                "Marked paid",
              )
            }
          >
            Mark paid
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  setOrderStatus({
                    data: { orderNumber, status: "cancelled", commandId: commandId() },
                  }),
                "Cancelled",
              )
            }
          >
            Cancel order
          </Button>
        </div>

        <Outcome error={error} done={done} />

        <Hint>
          <strong>Mark paid</strong> is a manual override for a payment that settled outside the
          webhook — reach for the reconcile sweep on Settings first, which heals a lost webhook from
          the provider&rsquo;s own record rather than from your assumption.
        </Hint>
      </div>
    </Section>
  );
}

function Shipment({ order }: { order: OrderDetailDTO }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Carrier", order.carrier ?? "—"],
    ["Tracking", order.trackingNumber ?? "—"],
    ["Shipped", when(order.shippedAt)],
    ["Delivered", when(order.deliveredAt)],
  ];
  if (order.fulfillmentNote) rows.push(["Note", order.fulfillmentNote]);
  return <Facts rows={rows} />;
}

// ── Timeline ─────────────────────────────────────────────────────────────────

/** `payment` is the provider talking; `operator` is a person. Coloured apart. */
const SOURCE_TONE: Record<string, string> = {
  payment: "text-primary",
  operator: "",
  customer: "text-muted-foreground",
};

function TimelineSection({ entries }: { entries: Timeline }) {
  return (
    <Section
      title="Timeline"
      description="Operator actions and provider reports, merged. Newest last."
    >
      {entries === null ? (
        <Empty>Could not read the timeline.</Empty>
      ) : entries.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {entries.map((entry, index) => (
            <li key={index} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span
                className={`w-20 shrink-0 text-xs font-semibold tracking-wide uppercase ${SOURCE_TONE[entry.source] ?? ""}`}
              >
                {entry.source}
              </span>
              <span className="font-medium">{entry.action}</span>
              <span className="text-muted-foreground">{entry.outcome}</span>
              {entry.detail ? (
                <span className="text-xs text-muted-foreground">{entry.detail}</span>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">
                {entry.actor ? `${entry.actor} · ` : ""}
                {when(entry.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
