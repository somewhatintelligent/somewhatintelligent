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
import { Archive, ArrowLeft, Clock, Package, Trash2 } from "lucide-react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

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
import { Empty, PageHeader, Section } from "../components/page.tsx";
import { Hint, Outcome } from "../components/outcome.tsx";
import { ProductStatusBadge } from "../components/badges.tsx";
import { DeletionDialog } from "../components/deletion-dialog.tsx";
import { AddSize, VariantEditor } from "../components/variant-editor.tsx";
import { Identity, ProductMarkets, ProductSizeGuide } from "../components/product-identity.tsx";
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

  const [archiving, setArchiving] = useState(false);
  const archive = async () => {
    setArchiving(true);
    try {
      await setProductStatus({ data: { productId, status: "archived", commandId: commandId() } });
      await refresh();
    } finally {
      setArchiving(false);
    }
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
  const { draft, markets, preorder, releases, variants, media } = detail;

  return (
    /**
     * THE PAGE SCROLLS AT XL NOW, and it has to. This container used to be a
     * fixed `100dvh` box with `overflow-hidden`, which fitted the editing grid
     * exactly and clipped anything beyond it — so appending the size-guide
     * panel to a clipped box would have made it unreachable rather than merely
     * lower down. The grid keeps its own bounded height, so its row ratios and
     * every `flex-1` inside it still resolve; what changed is that the panel
     * under it is scrolled to instead of cut off.
     *
     * The one-viewport rule is the SHOP product page's, not this one's. An
     * operator tool that scrolls is ordinary; an operator tool that hides a
     * control is not.
     */
    <div className="flex min-h-0 flex-1 flex-col gap-4 xl:h-[calc(100dvh-6rem)] xl:flex-none xl:overflow-y-auto">
      <PageHeader
        back={
          <Button
            variant="outline"
            size="icon-sm"
            nativeButton={false}
            aria-label="Back to products"
            render={<Link to="/products" search={{ status: "all" }} />}
          >
            <ArrowLeft className="size-4" />
          </Button>
        }
        title={draft.title}
        badges={
          <>
            <ProductStatusBadge status={draft.status} />
            <span className="text-sm text-muted-foreground">
              · {draft.activeVersion ? `v${draft.activeVersion}` : "never published"}
            </span>
          </>
        }
        actions={
          <>
            {draft.status === "archived" ? null : (
              <Button variant="outline" disabled={archiving} onClick={() => void archive()}>
                <Archive className="size-4" />
                Archive
              </Button>
            )}
            <DeletionDialog
              label={draft.title}
              description="Deletes the product and everything under it that is not retained for order history."
              plan={() => planProductDeletion({ data: { productId, commandId: commandId() } })}
              confirm={(payload) => deleteProduct({ data: payload })}
              onDeleted={async () => {
                await navigate({ to: "/products", search: { status: "all" } });
              }}
              trigger={
                <Button variant="destructive">
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              }
            />
          </>
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
        photograph, the name and the words. Price is product-level but gets its
        own card so it stays prominent without stealing width from the identity
        fields. Sizes follow the product because "what versions are there" is
        the next question anyone asks. What the DATABASE calls a draft row, an
        image table and a variant table is an implementation detail none of
        those questions mention.

        Lifecycle sits beside the sizes beneath that editing row: where a
        product is between draft and on sale is a different kind of fact from
        what it is, and it is the one an operator opens the page to change.
      */}
      {/*
        A DEFINITE HEIGHT AND NO SHRINKING at xl, which is what the two `fr`
        row tracks and every `flex-1`/`h-full` inside these four panels resolve
        against. `flex-1` would have worked while this was the container's only
        child; with the size-guide panel beside it, flexing means the two
        divide the viewport and the photograph loses half its height. Bounded
        here, the grid keeps the layout it was designed with and the panel is
        scrolled to.
      */}
      <div className="grid min-h-0 flex-1 items-start gap-4 xl:h-[calc(100dvh-9rem)] xl:flex-none xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.75fr)] xl:grid-rows-[minmax(0,3fr)_minmax(0,2fr)] xl:items-stretch">
        <Identity productId={productId} draft={draft} media={media} refresh={refresh} />

        <div className="grid min-h-0 min-w-0 gap-4 overflow-hidden xl:h-full xl:grid-rows-[minmax(9rem,0.8fr)_minmax(0,1.2fr)]">
          <ProductMarkets productId={productId} draft={draft} markets={markets} refresh={refresh} />
          <SellsAs
            productId={productId}
            preorder={preorder}
            variants={variants}
            refresh={refresh}
          />
        </div>

        <Variants
          productId={productId}
          slug={draft.slug}
          variants={variants}
          runCap={preorder.cap}
          refresh={refresh}
        />

        <Lifecycle draft={draft} releases={releases} refresh={refresh} />
      </div>

      {/*
        BELOW THE FOLD, and correctly so. The size guide is the last thing an
        operator adds and the only panel a shopper has to open a drawer to see,
        so it earns its own full-width row under the editing grid rather than a
        cell competing with the photograph for attention.
      */}
      <div className="xl:min-h-[22rem] xl:flex-none">
        <ProductSizeGuide productId={productId} draft={draft} refresh={refresh} />
      </div>
    </div>
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
    <Section
      title="Publish"
      description="Freezes the draft into a release, and puts it on sale."
      className="flex h-full self-stretch flex-col overflow-auto p-4"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Field className="w-28">
            <Label htmlFor="bump">Version</Label>
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

        <div className="min-w-0">
          <Label className="mb-1.5 block">Status</Label>
          <div className="flex flex-wrap gap-1.5">
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

        <div className="mt-auto border-t border-border pt-2">
          <h3 className="mb-1 text-sm font-semibold">Releases</h3>
          {releases.length === 0 ? (
            <Empty>Never published.</Empty>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {releases.map((release) => (
                <li key={release.id} className="flex items-center gap-3 py-1">
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
                      <Button variant="ghost" size="icon-sm" className="size-7" title="Delete size">
                        <Trash2 className="size-3.5" />
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
      title="Sales channel"
      className="flex h-full min-h-0 w-full self-stretch flex-col overflow-auto p-4"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Channel
            selected={!isRun}
            disabled={busy}
            onSelect={() => void apply("stock")}
            icon={<Package className="size-5" />}
            title="In stock"
            body="Sell available inventory."
          />
          <Channel
            selected={isRun}
            disabled={busy}
            onSelect={() => void apply("run")}
            icon={<Clock className="size-5" />}
            title="Made to order"
            body="Take orders, then make."
          />
        </div>

        <Outcome error={error} done={done} />

        {isRun && preorder.claimed > 0 ? (
          <Hint>
            Sold never resets — a second run means raising this to{" "}
            <strong>{preorder.claimed} + however many more</strong>.
          </Hint>
        ) : null}

        <div className="mt-auto grid grid-cols-[minmax(0,1.35fr)_minmax(4.5rem,0.65fr)_minmax(4.5rem,0.65fr)] overflow-hidden rounded-lg border border-border bg-surface-sunken">
          {isRun ? (
            <div className="p-3">
              <Field>
                <Label htmlFor="cap" className="text-xs text-muted-foreground">
                  Run size
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="cap"
                    inputMode="numeric"
                    value={cap}
                    onChange={(e) => setCap(e.target.value)}
                    className="h-8 min-w-0 tnum"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || cap === String(preorder.cap)}
                    onClick={() => void apply("run")}
                  >
                    Update
                  </Button>
                </div>
              </Field>
            </div>
          ) : (
            <div className="flex flex-col justify-center p-3">
              <span className="text-xs text-muted-foreground">Inventory</span>
              <span className="text-sm font-semibold">Tracked by size</span>
            </div>
          )}

          <dl className="contents">
            <div className="flex flex-col justify-center border-l border-border p-3">
              <dt className="text-xs text-muted-foreground">Sold</dt>
              <dd className="tnum font-display text-2xl font-semibold">{preorder.claimed}</dd>
            </div>
            <div className="flex flex-col justify-center border-l border-border p-3">
              <dt className="text-xs text-muted-foreground">Left</dt>
              <dd className="tnum font-display text-2xl font-semibold">
                {preorder.remaining ?? "—"}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </Section>
  );
}

/**
 * One of the two ways a product can be sold, as a card you pick rather than a
 * value you set in a dropdown. The choice decides what a row in the sizes table
 * MEANS, so it earns the room that makes both options readable at once.
 */
function Channel({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  body,
}: {
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && !selected && onSelect()}
      onKeyDown={(e) => {
        if (disabled || selected) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`relative flex min-h-16 cursor-pointer flex-col justify-center gap-0.5 rounded-lg border py-2 pr-10 pl-10 transition-colors ${
        selected ? "border-primary bg-primary/5" : "border-border hover:border-border-strong"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <span
        className={`absolute top-3 left-3 flex size-4 items-center justify-center rounded-full border-2 ${
          selected ? "border-primary" : "border-border-strong"
        }`}
      >
        {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{body}</span>
      <span className="absolute top-3 right-3 text-muted-foreground">{icon}</span>
    </div>
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
  const inventorySummary =
    runCap === null
      ? `${variants.reduce((total, variant) => total + variant.stock, 0)} units across sizes`
      : `${runCap}-piece run`;

  return (
    <Section
      title="Variants"
      description="Sizes, SKUs and inventory."
      actions={<AddSize productId={productId} slug={slug} runCap={runCap} onAdded={refresh} />}
      className="flex h-full self-stretch flex-col overflow-auto"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
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
                    className="h-7 w-12"
                    inputMode="numeric"
                    value={deltas[variant.id] ?? "1"}
                    onChange={(e) => setDeltas({ ...deltas, [variant.id]: e.target.value })}
                  />
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="size-7"
                    disabled={busy}
                    title="Add units"
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
                    size="icon-sm"
                    variant="outline"
                    className="size-7"
                    disabled={busy}
                    title="Remove units"
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

        <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            {variants.length} {variants.length === 1 ? "size" : "sizes"}
          </span>
          <span>One product price</span>
          <span className="ml-auto tnum font-medium text-foreground">{inventorySummary}</span>
        </div>
      </div>
    </Section>
  );
}
