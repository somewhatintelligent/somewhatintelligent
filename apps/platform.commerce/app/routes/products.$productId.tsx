/**
 * ONE PRODUCT, and the whole lifecycle the domain enforces:
 *
 *     create ──▶ draft edits ──▶ size ──▶ image ──▶ publish ──▶ active
 *
 * PUBLISH IS THE GATE, and it refuses rather than warns. A product with no
 * size or no image cannot publish; a product with no release cannot go active;
 * and a product with pre-order sizes but no run cap cannot go active either,
 * because the run guard would refuse every buyer. Those refusals arrive as
 * `missing_variant` / `missing_media` / `no_release` / `preorder_cap_missing`
 * and are rendered verbatim, because they are how the sequence becomes visible
 * instead of something you have to already know.
 *
 * A COVER is not a publish gate — any image satisfies the domain. It is a
 * listing gate, warned about separately, because a product with no cover goes
 * on sale with no picture.
 *
 * EVERY EDIT CARRIES `expectedRevision`. Two tabs open on one product is the
 * ordinary case, and the second save loses with `revision_conflict` rather than
 * silently overwriting the first.
 */
import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { Alert, AlertDescription, AlertTitle } from "platform.ui/components/alert";
import { Button } from "platform.ui/components/button";
import { Field } from "platform.ui/components/field";
import { Input } from "platform.ui/components/input";
import { Label } from "platform.ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "platform.ui/components/select";

import type { ProductDetail, ProductStatus } from "../../domain/Contracts.ts";
import { Empty, Facts, PageHeader, Section } from "../components/page.tsx";
import { Hint, Outcome } from "../components/outcome.tsx";
import { ProductStatusBadge } from "../components/badges.tsx";
import { DeletionDialog } from "../components/deletion-dialog.tsx";
import { AddSize, VariantEditor } from "../components/variant-editor.tsx";
import { Identity } from "../components/product-identity.tsx";
import { DataTable, Td, type Column } from "../components/table.tsx";
import {
  adjustStock,
  getProduct,
  publishProduct,
  putVariant,
  setPreorderCap,
  setProductStatus,
} from "../lib/catalog.functions.ts";
import {
  deleteProduct,
  deleteProductRelease,
  deleteVariant,
  planProductDeletion,
  planProductReleaseDeletion,
  planVariantDeletion,
} from "../lib/deletion.functions.ts";
import { commandId, refusalText, when } from "../lib/format.ts";

const STATUSES: ProductStatus[] = ["draft", "active", "unavailable", "archived"];

const VARIANT_COLUMNS: Column[] = [
  { label: "Size" },
  { label: "SKU" },
  { label: "Mode" },
  { label: "Stock", align: "right" },
  { label: "Adjust" },
  { label: "" },
];

export const Route = createFileRoute("/products/$productId")({
  loader: async ({ params }) => getProduct({ data: { productId: params.productId } }),
  component: Product,
});

/**
 * One mutation, with its own busy flag and its own outcome. Every panel below
 * uses it, so no panel can forget to render what the domain said.
 */
function useAction(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async <T,>(
    call: () => Promise<{ ok: true; value: T } | { ok: false; error: string; message?: string }>,
    success?: string,
  ): Promise<T | null> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await call();
      if (!result.ok) {
        setError(new Error(refusalText(result.error, result.message)));
        return null;
      }
      setDone(success ?? "Saved");
      await refresh();
      return result.value;
    } catch (cause) {
      setError(cause);
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, done, run };
}

function Product() {
  const result = Route.useLoaderData();
  const { productId } = Route.useParams();
  const router = useRouter();
  const navigate = Route.useNavigate();

  const refresh = async () => {
    await router.invalidate();
  };

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Product" />
        <Outcome error={new Error(refusalText(result.error, result.message))} />
      </>
    );
  }

  const detail: ProductDetail = result.value;
  const { draft, preorder, releases, variants, media } = detail;

  return (
    <>
      <PageHeader
        title={draft.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <ProductStatusBadge status={draft.status} />
            <span>{draft.slug}</span>
            <span>· revision {draft.revision}</span>
            <span>
              · {draft.activeVersion ? `live v${draft.activeVersion}` : "never published"}
            </span>
          </span>
        }
        actions={
          <DeletionDialog
            label={draft.title}
            description="Deletes the product and everything under it that is not retained for order history."
            plan={() => planProductDeletion({ data: { productId, commandId: commandId() } })}
            confirm={(input) => deleteProduct({ data: input })}
            onDeleted={async () => {
              await navigate({ to: "/products", search: { status: "all" } });
            }}
          />
        }
      />

      <Readiness detail={detail} />

      {/*
        ORDERED BY WHAT HAS TO HAPPEN, not by what the tables are called. The
        previous layout put Publish above the three things publish refuses
        without, so the first thing an operator could press was the one thing
        that could not yet work.

          1  details      already filled in by the create form
          2  how it sells decides what step 3 even asks for
          3  sizes        publish refuses without one
          4  images       publish refuses without one
          5  publish      and, in the same statement, goes on sale
      */}
      {/*
        WHAT IT IS, then WHERE IT IS. Not a form per table.

        The identity band is the product as a person thinks of it — the
        photograph, the name, the words, the price — and the sizes sit beside it
        because "what versions are there" is the next question anyone asks. What
        the DATABASE calls a draft row, an image table and a variant table is an
        implementation detail none of those questions mention.

        Lifecycle is the second half of the page rather than a panel inside the
        first: where a product is between draft and on sale is a different kind
        of fact from what it is, and it is the one an operator opens the page to
        change.
      */}
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(26rem,34rem)]">
        <Identity productId={productId} draft={draft} media={media} refresh={refresh} />
        <Variants
          productId={productId}
          slug={draft.slug}
          variants={variants}
          runCap={preorder.cap}
          refresh={refresh}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <Lifecycle draft={draft} releases={releases} refresh={refresh} />
        <SellsAs productId={productId} preorder={preorder} variants={variants} refresh={refresh} />
      </div>
    </>
  );
}

/**
 * WHAT STANDS BETWEEN THIS PRODUCT AND A SALE, in the order it bites.
 *
 * Each of these mirrors a refusal the domain will actually return, so the page
 * never claims a gate the code does not enforce — the previous version required
 * a COVER to publish, which was stricter than `publishProduct` and told the
 * operator they could not do something they could.
 */
function Readiness({ detail }: { detail: ProductDetail }) {
  const { preorder, variants, media } = detail;

  const hasCover = media.some((item) => item.role === "cover");

  /**
   * Pre-order sizes with no run to claim against — the run guard would match
   * zero rows and refuse every buyer. Both doors to `active` refuse this shape;
   * surfacing it on the draft is where it is cheap to fix.
   */
  const needsRunCap =
    preorder.cap === null && variants.some((variant) => variant.mode === "preorder");

  /** Named in the order the operator would add them. */
  const missing: string[] = [];
  if (variants.length === 0) missing.push("at least one size");
  if (media.length === 0) missing.push("at least one image");

  return (
    <>
      {missing.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>Not publishable yet</AlertTitle>
          <AlertDescription>
            Publish refuses until this product has <strong>{missing.join(" and ")}</strong>. Add{" "}
            {missing.length > 1 ? "them" : "it"} below.
          </AlertDescription>
        </Alert>
      ) : null}

      {missing.length === 0 && !hasCover ? (
        <Alert>
          <AlertTitle>No cover image</AlertTitle>
          <AlertDescription>
            Publish will accept this — any image satisfies it. But a listing shows the cover, so
            without one this product goes on sale with no picture. Set a role of <code>cover</code>{" "}
            on one of the images below.
          </AlertDescription>
        </Alert>
      ) : null}

      {needsRunCap ? (
        <Alert variant="destructive">
          <AlertTitle>This product cannot be bought</AlertTitle>
          <AlertDescription>
            It has pre-order sizes but no run cap, so every checkout would be refused with{" "}
            <code>preorder_full</code>. Set a cap below — publishing is refused until you do.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function Lifecycle({
  draft,
  releases,
  refresh,
}: {
  draft: ProductDetail["draft"];
  releases: ProductDetail["releases"];
  refresh: () => Promise<void>;
}) {
  const { busy, error, done, run } = useAction(refresh);
  const [bump, setBump] = useState<"major" | "minor" | "patch">("minor");

  return (
    <Section title="Publish" description="Freezes the draft into a release, and puts it on sale.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-32">
            <Label htmlFor="bump">Version bump</Label>
            <Select value={bump} onValueChange={(v) => v && setBump(v as typeof bump)}>
              <SelectTrigger id="bump">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="patch">patch</SelectItem>
                <SelectItem value="minor">minor</SelectItem>
                <SelectItem value="major">major</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  publishProduct({
                    data: {
                      productId: draft.productId,
                      expectedRevision: draft.revision,
                      bump,
                      commandId: commandId(),
                    },
                  }),
                "Published",
              )
            }
          >
            Publish
          </Button>
        </div>

        <div>
          <Label className="mb-1.5 block">Status</Label>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((status) => (
              <Button
                key={status}
                size="sm"
                variant={draft.status === status ? "default" : "outline"}
                disabled={busy || draft.status === status}
                onClick={() =>
                  void run(
                    () =>
                      setProductStatus({
                        data: { productId: draft.productId, status, commandId: commandId() },
                      }),
                    `Status is now ${status}`,
                  )
                }
              >
                {status}
              </Button>
            ))}
          </div>
        </div>

        <Outcome error={error} done={done} />

        <div>
          <h3 className="mb-1.5 text-sm font-semibold">Releases</h3>
          {releases.length === 0 ? (
            <Empty>Never published.</Empty>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {releases.map((release) => (
                <li key={release.id} className="flex items-center gap-3 py-1.5">
                  <span className="font-medium">v{release.version}</span>
                  {draft.activeVersion === release.version ? (
                    <span className="text-xs font-semibold text-success">active</span>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {when(release.publishedAt)}
                  </span>
                  <DeletionDialog
                    label={`release v${release.version}`}
                    description="Order history that references this release is retained; the release itself goes."
                    plan={() =>
                      planProductReleaseDeletion({
                        data: {
                          productId: draft.productId,
                          releaseId: release.id,
                          commandId: commandId(),
                        },
                      })
                    }
                    confirm={(input) => deleteProductRelease({ data: input })}
                    onDeleted={refresh}
                    trigger={
                      <Button variant="ghost" size="xs">
                        Delete
                      </Button>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

// ── How it sells ─────────────────────────────────────────────────────────────

/**
 * THE ONE DECISION THIS PRODUCT TURNS ON: do you have these, or are you taking
 * orders and making them after?
 *
 * It is one question to a person and two facts to the database — a cap on the
 * PRODUCT and a mode on every VARIANT — which is why it was previously two
 * panels that could disagree, and why a size could end up `preorder` under a
 * product with no cap and refuse every buyer. Asking once and writing both is
 * what makes that unreachable through the console rather than merely refused.
 *
 * ORDER MATTERS IN BOTH DIRECTIONS, and it is the same rule each way: never
 * leave the product in the shape where a pre-order size has no run to claim
 * against.
 *
 *   → run    cap FIRST, then flip the sizes
 *   → stock  sizes FIRST, then clear the cap
 */
function SellsAs({
  productId,
  preorder,
  variants,
  refresh,
}: {
  productId: string;
  preorder: ProductDetail["preorder"];
  variants: ProductDetail["variants"];
  refresh: () => Promise<void>;
}) {
  const isRun = preorder.cap !== null;
  const [cap, setCap] = useState(preorder.cap === null ? "50" : String(preorder.cap));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  /** Every step is a `DomainResult`; the first refusal stops the sequence. */
  const step = async (
    call: () => Promise<{ ok: true } | { ok: false; error: string; message?: string }>,
  ): Promise<boolean> => {
    const result = await call();
    if (result.ok) return true;
    setError(new Error(refusalText(result.error, result.message)));
    return false;
  };

  const setMode = (variant: ProductDetail["variants"][number], mode: "stock" | "preorder") =>
    step(() =>
      putVariant({
        data: {
          productId,
          variantId: variant.id,
          size: variant.size,
          sku: variant.sku,
          mode,
          // Omitted deliberately — `putVariant` writes stock ABSOLUTELY, and
          // this gesture is about how the product sells, not how many exist.
          commandId: commandId(),
        },
      }),
    );

  /**
   * TO A RUN: the cap FIRST, so the sizes are never pre-order with nothing to
   * claim against — the shape both `publishProduct` and `setProductStatus`
   * refuse. Then top each size up to the run by a RELATIVE delta, so a sale
   * landing mid-gesture is not rolled back by an absolute write.
   */
  const toRun = async (): Promise<boolean> => {
    const size = Number(cap);
    if (!Number.isInteger(size) || size < 1) {
      setError(new Error("A run needs a whole number of pieces — 50."));
      return false;
    }
    const opened = await step(() =>
      setPreorderCap({ data: { productId, cap: size, commandId: commandId() } }),
    );
    if (!opened) return false;

    for (const variant of variants) if (!(await setMode(variant, "preorder"))) return false;

    for (const variant of variants) {
      const short = size - variant.stock;
      if (short <= 0) continue;
      const topped = await step(() =>
        adjustStock({
          data: {
            variantId: variant.id,
            delta: short,
            reason: `run of ${size}`,
            commandId: commandId(),
          },
        }),
      );
      if (!topped) return false;
    }
    setDone(`Selling as a run of ${size}. Any size mix, ${size} pieces total.`);
    return true;
  };

  /** TO STOCK: the sizes first, then clear the cap — the same rule, reversed. */
  const toStock = async (): Promise<boolean> => {
    for (const variant of variants) if (!(await setMode(variant, "stock"))) return false;
    const closed = await step(() =>
      setPreorderCap({ data: { productId, cap: null, commandId: commandId() } }),
    );
    if (!closed) return false;
    setDone("Selling from stock. Each size sells what it has.");
    return true;
  };

  const apply = async (target: "stock" | "run") => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (await (target === "run" ? toRun() : toStock())) await refresh();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="How it sells"
      description="The one thing that decides what everything else means."
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply("stock")}
            className={`flex flex-col gap-1 rounded-md border-2 p-3 text-left transition-colors ${
              isRun ? "border-border hover:bg-surface-sunken" : "border-primary bg-surface-sunken"
            }`}
          >
            <span className="font-display text-sm font-semibold">From stock</span>
            <span className="text-xs text-muted-foreground">
              You have them. Each size sells what it has, and runs out on its own.
            </span>
          </button>

          <div
            className={`flex flex-col gap-2 rounded-md border-2 p-3 ${
              isRun ? "border-primary bg-surface-sunken" : "border-border"
            }`}
          >
            <span className="font-display text-sm font-semibold">As a run</span>
            <span className="text-xs text-muted-foreground">
              Take orders now, make them after. Any size mix, capped in total.
            </span>
            <div className="flex items-end gap-2">
              <Field className="w-24">
                <Label htmlFor="cap" className="text-xs">
                  Pieces
                </Label>
                <Input
                  id="cap"
                  inputMode="numeric"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                />
              </Field>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void apply("run")}>
                {isRun ? "Update run" : "Sell as a run"}
              </Button>
            </div>
          </div>
        </div>

        {isRun ? (
          <Facts
            rows={[
              ["Run size", preorder.cap],
              ["Sold", preorder.claimed],
              ["Left", preorder.remaining ?? "—"],
            ]}
          />
        ) : null}

        <Outcome error={error} done={done} />

        {isRun && preorder.claimed > 0 ? (
          <Hint>
            Sold never resets — a second run means raising this to{" "}
            <strong>{preorder.claimed} + however many more</strong>.
          </Hint>
        ) : null}
      </div>
    </Section>
  );
}

// ── Variants ─────────────────────────────────────────────────────────────────

function Variants({
  productId,
  slug,
  variants,
  runCap,
  refresh,
}: {
  productId: string;
  /** For deriving a SKU nobody typed. */
  slug: string;
  variants: ProductDetail["variants"];
  /** The run this product sells against, or `null` for shelf stock. */
  runCap: number | null;
  refresh: () => Promise<void>;
}) {
  const { busy, error, done, run } = useAction(refresh);
  const [deltas, setDeltas] = useState<Record<string, string>>({});

  const delta = (variantId: string) => Number(deltas[variantId] ?? "1") || 1;

  return (
    <Section
      title="Sizes"
      actions={<AddSize productId={productId} slug={slug} runCap={runCap} onAdded={refresh} />}
    >
      <div className="flex flex-col gap-3">
        <DataTable columns={VARIANT_COLUMNS}>
          {variants.map((variant) => (
            <tr key={variant.id}>
              <Td className="font-medium">{variant.size}</Td>
              <Td className="text-muted-foreground">{variant.sku}</Td>
              <Td>
                {variant.mode}
                {variant.mode === "preorder" && variant.expectedShipAt ? (
                  <span className="block text-xs text-muted-foreground">
                    ships {when(variant.expectedShipAt)}
                  </span>
                ) : null}
              </Td>
              <Td align="right">{variant.stock}</Td>
              <Td>
                <div className="flex items-center gap-1">
                  <Input
                    className="h-8 w-16"
                    inputMode="numeric"
                    value={deltas[variant.id] ?? "1"}
                    onChange={(e) => setDeltas({ ...deltas, [variant.id]: e.target.value })}
                  />
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          adjustStock({
                            data: {
                              variantId: variant.id,
                              delta: delta(variant.id),
                              reason: "console adjustment",
                              commandId: commandId(),
                            },
                          }),
                        "Stock adjusted",
                      )
                    }
                  >
                    +
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          adjustStock({
                            data: {
                              variantId: variant.id,
                              delta: -delta(variant.id),
                              reason: "console adjustment",
                              commandId: commandId(),
                            },
                          }),
                        "Stock adjusted",
                      )
                    }
                  >
                    −
                  </Button>
                </div>
              </Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <VariantEditor productId={productId} variant={variant} onSaved={refresh} />
                  <DeletionDialog
                    label={`variant ${variant.size}`}
                    plan={() =>
                      planVariantDeletion({
                        data: { productId, variantId: variant.id, commandId: commandId() },
                      })
                    }
                    confirm={(input) => deleteVariant({ data: input })}
                    onDeleted={refresh}
                    trigger={
                      <Button variant="ghost" size="xs">
                        Delete
                      </Button>
                    }
                  />
                </div>
              </Td>
            </tr>
          ))}
          {variants.length === 0 ? (
            <tr>
              <Td colSpan={6} className="py-6 text-center text-muted-foreground">
                No sizes yet. Publish refuses without one — add it above.
              </Td>
            </tr>
          ) : null}
        </DataTable>

        <Outcome error={error} done={done} />
      </div>
    </Section>
  );
}
