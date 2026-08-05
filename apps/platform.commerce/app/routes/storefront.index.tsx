/**
 * WHAT A SHOPPER ACTUALLY SEES.
 *
 * Sourced from the ACTIVE RELEASE, which is what makes this page worth having
 * separately from the catalogue. `listProducts` is the operator's view — every
 * status, the unpublished draft included — so "did my edit reach the shop" is a
 * question it cannot answer. This one can: a product missing here after a
 * publish means it never went active, and a price here that differs from the
 * draft means the draft has unpublished edits.
 *
 * Read-only, deliberately. There is no checkout on this page: placing an order
 * as an operator would file it under an actor who is not the buyer.
 */
import { createFileRoute, Link } from "@tanstack/react-router";

import { Empty, PageHeader, Section } from "../components/page.tsx";
import { Hint } from "../components/outcome.tsx";
import { listStorefront } from "../lib/storefront.functions.ts";
import { money } from "../lib/format.ts";

export const Route = createFileRoute("/storefront/")({
  loader: async () => listStorefront(),
  component: Storefront,
});

function Storefront() {
  const products = Route.useLoaderData();

  return (
    <>
      <PageHeader
        title="Storefront"
        subtitle="The active release of every product on sale — the shopper's view, not yours."
      />

      <Section
        title="On sale"
        description={`${products.length} product${products.length === 1 ? "" : "s"} a shopper can buy right now`}
      >
        {products.length === 0 ? (
          <Empty>
            Nothing is on sale. A product needs a release and the <code>active</code> status.{" "}
            <Link to="/products" search={{ status: "all" }} className="underline">
              Go to the catalogue.
            </Link>
          </Empty>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <li key={product.slug}>
                <Link
                  to="/storefront/$slug"
                  params={{ slug: product.slug }}
                  className="flex flex-col gap-2 rounded-md border border-border bg-surface-raised p-3 transition-colors hover:bg-surface-sunken"
                >
                  {/*
                   * The public href, served here by the console's own worker.
                   * These products are active, so the same path would resolve on
                   * the storefront too — which is the point of showing them.
                   */}
                  {product.coverHref ? (
                    <img
                      src={product.coverHref}
                      alt={product.title}
                      className="aspect-square w-full rounded-sm object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded-sm border border-dashed border-border text-xs text-muted-foreground">
                      no cover
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{product.title}</span>
                    <span className="tnum shrink-0">
                      {money(product.priceCents, product.currency.toUpperCase())}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{product.slug}</span>
                    <span>v{product.version}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Hint>
          A product here whose price differs from its draft has unpublished edits. A product missing
          here after a publish never went <code>active</code>.
        </Hint>
      </Section>
    </>
  );
}
