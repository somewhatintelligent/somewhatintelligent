/**
 * THE OVERVIEW — what needs doing, and whether the money plumbing is sound.
 *
 * Two questions, in that order. The top half is work: orders waiting to be
 * shipped, orders whose payment has not arrived, products still in draft. The
 * bottom half is the thing you check before a launch and then never again until
 * something is wrong — which provider mints sessions, which one settles them,
 * and whether they agree.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "platform.ui/components/alert";
import { Button } from "platform.ui/components/button";

import { Empty, Facts, PageHeader, Section } from "../components/page.tsx";
import { OrderStatusBadge, ProductStatusBadge } from "../components/badges.tsx";
import { listOrders } from "../lib/orders.functions.ts";
import { listProducts } from "../lib/catalog.functions.ts";
import { paymentsProvider, settlementProvider } from "../lib/admin.functions.ts";
import { money, when } from "../lib/format.ts";

export const Route = createFileRoute("/")({
  /**
   * Everything in parallel, and nothing fatal. A provider read that fails
   * should not take the work queue off the screen — the settings page is where
   * a broken provider is diagnosed, and this page still has to be usable while
   * it is broken.
   */
  loader: async () => {
    const [orders, products, minting, settling] = await Promise.all([
      listOrders({ data: { status: "all", limit: 50 } }),
      listProducts({ data: { status: "all", limit: 100 } }),
      paymentsProvider().catch(() => null),
      settlementProvider().catch(() => null),
    ]);
    return { orders, products, minting, settling };
  },
  component: Overview,
});

function Overview() {
  const { orders, products, minting, settling } = Route.useLoaderData();

  const orderRows = orders.ok ? orders.value.orders : [];
  const productRows = products.ok ? products.value.products : [];

  const awaitingPayment = orderRows.filter((o) => o.status === "pending");
  const toShip = orderRows.filter((o) => o.status === "paid");
  const drafts = productRows.filter((p) => p.status === "draft");
  const live = productRows.filter((p) => p.status === "active");

  /**
   * THE ONE CONFIGURATION MISTAKE THAT TAKES MONEY AND LOSES IT. A session
   * minted by one provider cannot be settled by the other, so a deployment
   * where these disagree checks out successfully and never marks an order paid.
   * Both Workers resolve their provider independently, which is exactly why it
   * is worth asserting here rather than assuming.
   */
  const providersDisagree = minting !== null && settling !== null && minting !== settling.kind;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="What is waiting on you, and what this deployment is wired to."
      />

      {providersDisagree ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Checkout and settlement are on different providers</AlertTitle>
          <AlertDescription>
            Commerce mints sessions with <strong>{minting}</strong> and Settlement settles with{" "}
            <strong>{settling.kind}</strong>. A payment taken now will never mark its order paid. Do
            not sell until this agrees.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting payment" value={awaitingPayment.length} to="/orders" />
        <Stat
          label="Ready to ship"
          value={toShip.length}
          to="/orders"
          emphasis={toShip.length > 0}
        />
        <Stat label="Live products" value={live.length} to="/products" />
        <Stat label="Drafts" value={drafts.length} to="/products" />
      </div>

      <Section
        title="Ready to ship"
        description="Paid, not yet fulfilled. Add a carrier and a tracking number to move them on."
        actions={
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/orders" search={{ status: "all" }} />}
          >
            All orders <ArrowRight />
          </Button>
        }
      >
        {toShip.length === 0 ? (
          <Empty>Nothing waiting. Every paid order has shipped.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {toShip.slice(0, 8).map((order) => (
              <li key={order.orderNumber}>
                <Link
                  to="/orders/$orderNumber"
                  params={{ orderNumber: order.orderNumber }}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm hover:bg-surface-sunken"
                >
                  <span className="font-medium">{order.orderNumber}</span>
                  <span className="text-muted-foreground">{order.email}</span>
                  <span className="ml-auto tnum">{money(order.totalCents)}</span>
                  <span className="text-xs text-muted-foreground">{when(order.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Recent orders" description="Newest first, every status.">
          {orderRows.length === 0 ? (
            <Empty>No orders yet.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {orderRows.slice(0, 6).map((order) => (
                <li key={order.orderNumber}>
                  <Link
                    to="/orders/$orderNumber"
                    params={{ orderNumber: order.orderNumber }}
                    className="flex items-center gap-3 py-2 text-sm hover:bg-surface-sunken"
                  >
                    <OrderStatusBadge status={order.status} />
                    <span className="truncate">{order.orderNumber}</span>
                    <span className="ml-auto tnum">{money(order.totalCents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Products" description="Everything in the catalogue.">
          {productRows.length === 0 ? (
            <Empty>
              Nothing yet.{" "}
              <Link to="/products" search={{ status: "all" }} className="underline">
                Create the first product.
              </Link>
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {productRows.slice(0, 6).map((product) => (
                <li key={product.productId}>
                  <Link
                    to="/products/$productId"
                    params={{ productId: product.productId }}
                    className="flex items-center gap-3 py-2 text-sm hover:bg-surface-sunken"
                  >
                    <ProductStatusBadge status={product.status} />
                    <span className="truncate">{product.title}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {product.activeVersion ?? "unpublished"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Payments" description="What this deployment is wired to.">
        <Facts
          rows={[
            ["Checkout mints with", minting ?? "unreadable"],
            ["Settlement settles with", settling?.kind ?? "unreadable"],
            [
              "Live money",
              settling === null ? "unreadable" : settling.livemode ? "YES — real cards" : "no",
            ],
          ]}
        />
      </Section>
    </>
  );
}

function Stat({
  label,
  value,
  to,
  emphasis,
}: {
  label: string;
  value: number;
  to: string;
  emphasis?: boolean;
}) {
  return (
    <Link
      to={to}
      className={
        emphasis
          ? "rounded-md border-2 border-primary bg-card p-4 transition-colors hover:bg-surface-sunken"
          : "rounded-md border border-border bg-card p-4 transition-colors hover:bg-surface-sunken"
      }
    >
      <div className="text-xs tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="tnum mt-1 font-display text-3xl font-semibold">{value}</div>
    </Link>
  );
}
