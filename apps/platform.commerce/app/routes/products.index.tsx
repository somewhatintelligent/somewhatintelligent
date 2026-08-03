/**
 * The catalogue list, and the one place a product is created.
 *
 * Creating takes three fields and lands a DRAFT. Nothing a shopper sees moves
 * until publish, and publish refuses until the product has a variant and a
 * cover — so the shortest honest path to a sellable product is: create here,
 * then finish it on its own page.
 */
import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { Button } from "platform.ui/components/button";
import { Field, FieldDescription } from "platform.ui/components/field";
import { Input } from "platform.ui/components/input";
import { Label } from "platform.ui/components/label";

import type { ProductStatus } from "../../domain/Contracts.ts";
import { PageHeader, Section } from "../components/page.tsx";
import { Outcome } from "../components/outcome.tsx";
import { ProductStatusBadge } from "../components/badges.tsx";
import { RecordList, Td, type Column } from "../components/table.tsx";
import { createProduct, listProducts } from "../lib/catalog.functions.ts";
import { centsFrom, commandId, money, refusalText, when } from "../lib/format.ts";

const STATUSES: Array<ProductStatus | "all"> = [
  "all",
  "draft",
  "active",
  "unavailable",
  "archived",
];

const COLUMNS: Column[] = [
  { label: "Product" },
  { label: "Status" },
  { label: "Live version" },
  { label: "Price", align: "right" },
  { label: "Updated" },
];

export const Route = createFileRoute("/products/")({
  /**
   * The filter is in the URL rather than in component state, so a filtered
   * view is a link someone can send and a reload keeps.
   */
  validateSearch: (search: Record<string, unknown>): { status: ProductStatus | "all" } => {
    const status = search["status"];
    return {
      status: STATUSES.includes(status as ProductStatus | "all")
        ? (status as ProductStatus | "all")
        : "all",
    };
  },
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => listProducts({ data: { status: deps.status, limit: 200 } }),
  component: Products,
});

function Products() {
  const result = Route.useLoaderData();
  const { status } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ slug: "", title: "", price: "45.00" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const products = result.ok ? result.value.products : [];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const priceCents = centsFrom(form.price);
    if (priceCents === null || priceCents < 0) {
      setError(new Error("Price must be a number, in dollars — 45.00"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createProduct({
        data: {
          slug: form.slug.trim(),
          title: form.title.trim(),
          priceCents,
          commandId: commandId(),
        },
      });
      if (!created.ok) {
        setError(new Error(refusalText(created.error, created.message)));
        return;
      }
      setCreating(false);
      setForm({ slug: "", title: "", price: "45.00" });
      /** Straight into the product, because a bare draft is not yet sellable. */
      await navigate({
        to: "/products/$productId",
        params: { productId: created.value.productId },
      });
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
      await router.invalidate();
    }
  };

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Draft is yours. A release is what shoppers get."
        actions={
          <Button onClick={() => setCreating((open) => !open)}>
            <Plus />
            New product
          </Button>
        }
      />

      {creating ? (
        <Section title="New product" description="Three fields now; the rest on the product page.">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <Label htmlFor="new-title">Title</Label>
                <Input
                  id="new-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Charcoal Tee"
                  required
                />
              </Field>
              <Field>
                <Label htmlFor="new-slug">Slug</Label>
                <Input
                  id="new-slug"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  placeholder="charcoal-tee"
                  required
                />
                <FieldDescription>The storefront URL. Must be unique.</FieldDescription>
              </Field>
              <Field>
                <Label htmlFor="new-price">Price</Label>
                <Input
                  id="new-price"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  inputMode="decimal"
                  required
                />
                <FieldDescription>Dollars. Stored as cents.</FieldDescription>
              </Field>
            </div>
            <Outcome error={error} />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !form.slug || !form.title}>
                {busy ? "Creating…" : "Create draft"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Section>
      ) : null}

      <RecordList
        title="Catalogue"
        description={`${products.length} product${products.length === 1 ? "" : "s"}`}
        filter={{
          value: status,
          options: STATUSES,
          onChange: (next) => void navigate({ search: { status: next } }),
        }}
        refusal={result.ok ? null : refusalText(result.error, result.message)}
        columns={COLUMNS}
        isEmpty={products.length === 0}
        empty="Nothing here yet."
      >
        {products.map((product) => (
          <tr key={product.productId} className="hover:bg-surface-sunken">
            <Td>
              <Link
                to="/products/$productId"
                params={{ productId: product.productId }}
                className="font-medium underline-offset-4 hover:underline"
              >
                {product.title}
              </Link>
              <div className="text-xs text-muted-foreground">{product.slug}</div>
            </Td>
            <Td>
              <ProductStatusBadge status={product.status} />
            </Td>
            <Td className="text-muted-foreground">{product.activeVersion ?? "unpublished"}</Td>
            <Td align="right">{money(product.priceCents)}</Td>
            <Td className="text-xs text-muted-foreground">{when(product.updatedAt)}</Td>
          </tr>
        ))}
      </RecordList>
    </>
  );
}
