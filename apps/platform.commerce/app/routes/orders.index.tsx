/**
 * The order book.
 *
 * Filtered by status through the URL, so a "what do I ship today" view is a
 * link. `paid` is that view: money in, nothing sent.
 */
import { createFileRoute, Link } from "@tanstack/react-router";

import type { OrderStatus } from "../../domain/Contracts.ts";
import { PageHeader, Section } from "../components/page.tsx";
import { OrderStatusBadge, PaymentBadge } from "../components/badges.tsx";
import { FulfillmentDemandSummary } from "../components/fulfillment-demand.tsx";
import { RecordList, Td, type Column } from "../components/table.tsx";
import { fulfillmentDemand, listOrders } from "../lib/orders.functions.ts";
import { money, refusalText, when } from "../lib/format.ts";

const STATUSES: Array<OrderStatus | "all"> = [
  "all",
  "pending",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
];

/**
 * `paid` is the actionable view, so this page prints it as the work it is.
 * One map, so the heading and the filter cannot drift.
 */
const STATUS_LABELS: Partial<Record<OrderStatus | "all", string>> = { paid: "ready to ship" };

const heading = (status: OrderStatus | "all"): string => {
  if (status === "all") return "All orders";
  const label = STATUS_LABELS[status];
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : `${status} orders`;
};

const COLUMNS: Column[] = [
  { label: "Order" },
  { label: "Buyer" },
  { label: "Status" },
  { label: "Payment" },
  { label: "Total", align: "right" },
  { label: "Placed" },
];

export const Route = createFileRoute("/orders/")({
  validateSearch: (search: Record<string, unknown>): { status: OrderStatus | "all" } => {
    const status = search["status"];
    return {
      status: STATUSES.includes(status as OrderStatus | "all")
        ? (status as OrderStatus | "all")
        : "paid",
    };
  },
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => {
    const [orders, demand] = await Promise.all([
      listOrders({ data: { status: deps.status, limit: 200 } }),
      deps.status === "paid" ? fulfillmentDemand().catch(() => null) : Promise.resolve(null),
    ]);
    return { orders, demand };
  },
  component: Orders,
});

function Orders() {
  const { orders: result, demand } = Route.useLoaderData();
  const { status } = Route.useSearch();
  const navigate = Route.useNavigate();

  const orders = result.ok ? result.value.orders : [];

  return (
    <>
      <PageHeader title="Orders" subtitle="Every order this deployment has taken." />

      {/*
        `demand` is only requested for the paid view, so `null` there means the
        read FAILED and the summary says so. A demand of zero drops the section
        instead — the list below already states its own empty.
      */}
      {status === "paid" && (demand === null || demand.orderCount > 0) ? (
        <Section
          title="Fulfilment demand"
          description="Paid, not yet shipped. Pre-order manufacturing is kept separate from physical stock."
        >
          <FulfillmentDemandSummary demand={demand} />
        </Section>
      ) : null}

      <RecordList
        title={heading(status)}
        description={`${orders.length} order${orders.length === 1 ? "" : "s"}`}
        filter={{
          value: status,
          options: STATUSES,
          labels: STATUS_LABELS,
          onChange: (next) => void navigate({ search: { status: next } }),
        }}
        refusal={result.ok ? null : refusalText(result.error, result.message)}
        columns={COLUMNS}
        isEmpty={orders.length === 0}
        empty="No orders here."
      >
        {orders.map((order) => (
          <tr key={order.orderNumber} className="hover:bg-surface-sunken">
            <Td>
              <Link
                to="/orders/$orderNumber"
                params={{ orderNumber: order.orderNumber }}
                className="font-medium underline-offset-4 hover:underline"
              >
                {order.orderNumber}
              </Link>
            </Td>
            <Td>
              <div className="truncate">{order.email}</div>
              {order.shipName ? (
                <div className="text-xs text-muted-foreground">{order.shipName}</div>
              ) : null}
            </Td>
            <Td>
              <OrderStatusBadge status={order.status} />
            </Td>
            <Td>
              <PaymentBadge status={order.paymentStatus} />
            </Td>
            <Td align="right">{money(order.totalCents)}</Td>
            <Td className="text-xs text-muted-foreground">{when(order.createdAt)}</Td>
          </tr>
        ))}
      </RecordList>
    </>
  );
}
