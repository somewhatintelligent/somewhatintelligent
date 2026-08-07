/**
 * ONE PRODUCT AS A SHOPPER GETS IT — the last check before, and after, a
 * publish.
 *
 * Built from `getStorefrontProduct`, which reads the ACTIVE RELEASE, so
 * everything here is what is actually on sale rather than what the draft says.
 * The differences worth catching are the quiet ones: a description that was
 * edited but never published, a variant that reads `available: false` because
 * its stock ran out rather than because anyone withdrew it, a gallery whose
 * order is not the order that was intended.
 *
 * `available` is DERIVED server-side from live stock and the pre-order run —
 * this page cannot compute it and does not try.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { Badge } from "platform.ui/components/badge";
import { Button } from "platform.ui/components/button";

import { Empty, PageHeader, Section } from "../components/page.tsx";
import { Hint } from "../components/outcome.tsx";
import { getStorefrontProduct } from "../lib/storefront.functions.ts";
import { money, position } from "../lib/format.ts";

export const Route = createFileRoute("/storefront/$slug")({
  loader: async ({ params }) => getStorefrontProduct({ data: { slug: params.slug } }),
  component: StorefrontProduct,
});

function StorefrontProduct() {
  const product = Route.useLoaderData();
  const { slug } = Route.useParams();

  const back = (
    <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/storefront" />}>
      <ArrowLeft />
      Storefront
    </Button>
  );

  /**
   * `null` here is not an error — it is the shop correctly refusing to serve a
   * product that is not active. Which is exactly the answer someone lands on
   * this page to get.
   */
  if (!product) {
    return (
      <>
        <PageHeader title={slug} actions={back} />
        <Section title="Not on sale">
          <Empty>
            No active release answers to <code>{slug}</code>. A shopper following this link gets a
            404. Publish the product and set it <code>active</code> to change that.
          </Empty>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={product.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{product.slug}</span>
            <span>· v{product.version}</span>
            <span>· {money(product.priceCents, product.currency.toUpperCase())}</span>
          </span>
        }
        actions={back}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Media" description="In the order a shopper sees them.">
          {product.media.length === 0 ? (
            <Empty>No images.</Empty>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {product.media.map((item, index) => (
                <li key={`${item.href}-${index}`} className="flex flex-col gap-2">
                  <img
                    src={item.href}
                    alt={item.alt}
                    className="aspect-square w-full rounded-sm border border-border object-cover"
                    loading="lazy"
                  />
                  <div className="flex items-center gap-2">
                    {/*
                      THE POSITION, which is the only thing that distinguishes
                      one of these from another now — and it is ONE-BASED, like
                      the operator gallery's numbers and the shop's filmstrip.
                      `01` is the listing cover and the shot the product page
                      opens on; the rest follow it in this order. Three places
                      print this number and a shopper sees one of them, so all
                      three have to count the same way.
                    */}
                    <Badge variant={index === 0 ? "outline" : "secondary"}>
                      {position(index)}
                      {index === 0 ? " · cover" : ""}
                    </Badge>
                    <span className="truncate text-xs text-muted-foreground">{item.alt}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Sizes" description="Availability is live stock, computed server-side.">
          {product.variants.length === 0 ? (
            <Empty>No variants on this release.</Empty>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {product.variants.map((variant) => (
                <li key={variant.id}>
                  <Badge variant={variant.available ? "outline" : "secondary"}>
                    {variant.size}
                    {variant.available ? "" : " · sold out"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <Hint>
            Availability is both counters at once: units left in that size, AND places left in the
            run if it is a pre-order. A size reads sold out when either is exhausted, which is the
            same rule checkout enforces — so what shows here is what a shopper can actually buy.
          </Hint>
        </Section>
      </div>

      <Section title="Description" description="As published. Draft edits do not appear here.">
        {product.descriptionMarkdown ? (
          <pre className="font-editorial text-sm whitespace-pre-wrap">
            {product.descriptionMarkdown}
          </pre>
        ) : (
          <Empty>No description on this release.</Empty>
        )}
      </Section>
    </>
  );
}
