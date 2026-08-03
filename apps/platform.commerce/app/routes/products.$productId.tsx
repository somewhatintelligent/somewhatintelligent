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
import { GripVertical, Upload } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "platform.ui/components/alert";
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
import { Textarea } from "platform.ui/components/textarea";

import type { ProductDetail, ProductMediaRole, ProductStatus } from "../../domain/Contracts.ts";
import { Empty, Facts, PageHeader, Section } from "../components/page.tsx";
import { Hint, Outcome } from "../components/outcome.tsx";
import { ProductStatusBadge, RoleBadge } from "../components/badges.tsx";
import { DeletionDialog } from "../components/deletion-dialog.tsx";
import { VariantEditor } from "../components/variant-editor.tsx";
import { DataTable, Td, type Column } from "../components/table.tsx";
import {
  adjustStock,
  getProduct,
  ingestProductMedia,
  publishProduct,
  putVariant,
  reorderProductMedia,
  saveProductDraft,
  setPreorderCap,
  setProductStatus,
} from "../lib/catalog.functions.ts";
import {
  deleteProduct,
  deleteProductMedia,
  deleteProductRelease,
  deleteVariant,
  planProductDeletion,
  planProductMediaDeletion,
  planProductReleaseDeletion,
  planVariantDeletion,
} from "../lib/deletion.functions.ts";
import { centsFrom, commandId, dollarsFrom, refusalText, when } from "../lib/format.ts";

const STATUSES: ProductStatus[] = ["draft", "active", "unavailable", "archived"];
const ROLES: ProductMediaRole[] = ["cover", "gallery", "evidence"];

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

      <Draft draft={draft} refresh={refresh} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Lifecycle draft={draft} releases={releases} refresh={refresh} />
        <Preorder productId={productId} preorder={preorder} refresh={refresh} />
      </div>

      <Variants productId={productId} variants={variants} refresh={refresh} />
      <Media productId={productId} media={media} status={draft.status} refresh={refresh} />
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

// ── Draft ────────────────────────────────────────────────────────────────────

function Draft({
  draft,
  refresh,
}: {
  draft: ProductDetail["draft"];
  refresh: () => Promise<void>;
}) {
  const { busy, error, done, run } = useAction(refresh);
  const [form, setForm] = useState({
    title: draft.title,
    slug: draft.slug,
    price: dollarsFrom(draft.priceCents),
    descriptionMarkdown: draft.descriptionMarkdown ?? "",
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const priceCents = centsFrom(form.price);
    if (priceCents === null || priceCents < 0) return;
    await run(
      () =>
        saveProductDraft({
          data: {
            productId: draft.productId,
            /** From the read this form was rendered from — that is the whole guard. */
            expectedRevision: draft.revision,
            title: form.title,
            slug: form.slug,
            priceCents,
            descriptionMarkdown: form.descriptionMarkdown || null,
            commandId: commandId(),
          },
        }),
      "Draft saved",
    );
  };

  return (
    <Section
      title="Draft"
      description="Edits land here. What a shopper sees does not move until publish."
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field>
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </Field>
          <Field>
            <Label htmlFor="price">Price</Label>
            <Input
              id="price"
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
            <FieldDescription>Dollars. Stored as cents.</FieldDescription>
          </Field>
        </div>
        <Field>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={5}
            value={form.descriptionMarkdown}
            onChange={(e) => setForm({ ...form, descriptionMarkdown: e.target.value })}
            placeholder="Markdown. Shown on the product page."
          />
        </Field>
        <Outcome error={error} done={done} />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save draft"}
          </Button>
        </div>
      </form>
    </Section>
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
      title="Lifecycle"
      description="Publishing freezes the draft into an immutable release."
    >
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
          <Hint>
            <strong>active</strong> is on sale. <strong>unavailable</strong> is published but pulled
            — its images stop being served too. <strong>archived</strong> is retired. Going active
            needs a release.
          </Hint>
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

// ── Pre-order ────────────────────────────────────────────────────────────────

function Preorder({
  productId,
  preorder,
  refresh,
}: {
  productId: string;
  preorder: ProductDetail["preorder"];
  refresh: () => Promise<void>;
}) {
  const { busy, error, done, run } = useAction(refresh);
  const [cap, setCap] = useState(preorder.cap === null ? "" : String(preorder.cap));

  return (
    <Section
      title="Pre-order run"
      description="A capped manufacturing run, rather than shelf stock."
    >
      <div className="flex flex-col gap-4">
        <Facts
          rows={[
            ["Cap", preorder.cap === null ? "not a pre-order" : preorder.cap],
            ["Claimed", preorder.claimed],
            ["Remaining", preorder.remaining ?? "—"],
          ]}
        />
        <div className="flex items-end gap-2">
          <Field className="w-32">
            <Label htmlFor="cap">Cap</Label>
            <Input
              id="cap"
              inputMode="numeric"
              value={cap}
              placeholder="no cap"
              onChange={(e) => setCap(e.target.value)}
            />
          </Field>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  setPreorderCap({
                    data: {
                      productId,
                      cap: cap.trim() === "" ? null : Number(cap),
                      commandId: commandId(),
                    },
                  }),
                "Cap set",
              )
            }
          >
            Set cap
          </Button>
        </div>
        <Outcome error={error} done={done} />
        <Hint>
          Empty means this product is not sold as a pre-order. Lowering the cap below what buyers
          have already claimed is refused with <code>cap_below_claimed</code> — the run keeps its
          promises.
        </Hint>
      </div>
    </Section>
  );
}

// ── Variants ─────────────────────────────────────────────────────────────────

function Variants({
  productId,
  variants,
  refresh,
}: {
  productId: string;
  variants: ProductDetail["variants"];
  refresh: () => Promise<void>;
}) {
  const { busy, error, done, run } = useAction(refresh);
  const [form, setForm] = useState({
    size: "M",
    sku: "",
    stock: "10",
    mode: "stock" as "stock" | "preorder",
    expectedShipAt: "",
  });
  const [deltas, setDeltas] = useState<Record<string, string>>({});

  const delta = (variantId: string) => Number(deltas[variantId] ?? "1") || 1;

  return (
    <Section title="Variants" description="Size, SKU and what is left to sell.">
      <div className="flex flex-col gap-4">
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
              <Td colSpan={6} className="py-4 text-center text-muted-foreground">
                None — publish refuses with <code>missing_variant</code>.
              </Td>
            </tr>
          ) : null}
        </DataTable>

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <Field className="w-20">
            <Label htmlFor="v-size">Size</Label>
            <Input
              id="v-size"
              value={form.size}
              onChange={(e) => setForm({ ...form, size: e.target.value })}
            />
          </Field>
          <Field className="w-44">
            <Label htmlFor="v-sku">SKU</Label>
            <Input
              id="v-sku"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="TEE-CHR-M"
            />
          </Field>
          <Field className="w-24">
            <Label htmlFor="v-stock">Opening stock</Label>
            <Input
              id="v-stock"
              inputMode="numeric"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
            />
          </Field>
          <Field className="w-32">
            <Label htmlFor="v-mode">Mode</Label>
            <Select
              value={form.mode}
              onValueChange={(v) => v && setForm({ ...form, mode: v as "stock" | "preorder" })}
            >
              <SelectTrigger id="v-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stock">stock</SelectItem>
                <SelectItem value="preorder">preorder</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.mode === "preorder" ? (
            <Field className="w-44">
              <Label htmlFor="v-ship">Expected ship</Label>
              <Input
                id="v-ship"
                type="date"
                value={form.expectedShipAt}
                onChange={(e) => setForm({ ...form, expectedShipAt: e.target.value })}
              />
            </Field>
          ) : null}
          <Button
            disabled={busy || !form.sku}
            onClick={() =>
              void run(
                () =>
                  putVariant({
                    data: {
                      productId,
                      size: form.size,
                      sku: form.sku,
                      stock: Number(form.stock) || 0,
                      mode: form.mode,
                      expectedShipAt:
                        form.mode === "preorder" && form.expectedShipAt
                          ? new Date(form.expectedShipAt).getTime()
                          : null,
                      commandId: commandId(),
                    },
                  }),
                "Variant added",
              )
            }
          >
            Add size
          </Button>
        </div>

        <Outcome error={error} done={done} />
        <Hint>
          This form only ADDS. A duplicate size or SKU is refused rather than merged — use Edit on
          the row to change one. After that, stock only moves by a RELATIVE ± delta, never a value
          typed from a stale read, so two people adjusting at once both land.
        </Hint>
      </div>
    </Section>
  );
}

// ── Media ────────────────────────────────────────────────────────────────────

function Media({
  productId,
  media,
  status,
  refresh,
}: {
  productId: string;
  media: ProductDetail["media"];
  status: ProductStatus;
  refresh: () => Promise<void>;
}) {
  const { busy, error, done, run } = useAction(refresh);
  const [role, setRole] = useState<ProductMediaRole>("cover");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<unknown>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    const body = new FormData();
    body.set("file", file);
    body.set("productId", productId);
    body.set("role", role);
    body.set("alt", alt);
    body.set("commandId", commandId());
    try {
      const result = await ingestProductMedia({ data: body });
      if (!result.ok) {
        setUploadError(new Error(refusalText(result.error, result.message)));
        return;
      }
      setAlt("");
      await refresh();
    } catch (cause) {
      setUploadError(cause);
    } finally {
      setUploading(false);
    }
  };

  /** Move one image up or down and commit the whole order — the domain takes a full list. */
  const move = async (index: number, direction: -1 | 1) => {
    const next = [...media];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    await run(
      () =>
        reorderProductMedia({
          data: {
            productId,
            mediaIds: next.map((item) => item.id),
            commandId: commandId(),
          },
        }),
      "Order saved",
    );
  };

  return (
    <Section
      title="Media"
      description="Ordered. The cover is what a listing shows; gallery and evidence both reach shoppers."
    >
      <div className="flex flex-col gap-4">
        {media.length === 0 ? (
          <Empty>
            None — publish refuses with <code>missing_media</code> until a cover exists.
          </Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {media.map((item, index) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface-raised p-2"
              >
                {/*
                 * `item.href` is the root-relative `/media/<id>` the domain
                 * spells. On this hostname that path is served by the console's
                 * OWN worker from a binding-only read with no status gate — so
                 * a draft's cover is visible here even though the public route
                 * would 404 it. See `app/worker.ts`.
                 */}
                <img
                  src={item.href}
                  alt={item.alt}
                  className="aspect-square w-full rounded-sm object-cover"
                  loading="lazy"
                />
                <div className="flex items-center gap-2">
                  <RoleBadge role={item.role} />
                  <span className="truncate text-xs text-muted-foreground" title={item.alt}>
                    {item.alt}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy || index === 0}
                    onClick={() => void move(index, -1)}
                    title="Move earlier"
                  >
                    <GripVertical className="rotate-90" />↑
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy || index === media.length - 1}
                    onClick={() => void move(index, 1)}
                    title="Move later"
                  >
                    ↓
                  </Button>
                  <div className="ml-auto">
                    <DeletionDialog
                      label="image"
                      plan={() =>
                        planProductMediaDeletion({
                          data: { productId, mediaId: item.id, commandId: commandId() },
                        })
                      }
                      confirm={(input) => deleteProductMedia({ data: input })}
                      onDeleted={refresh}
                      trigger={
                        <Button variant="ghost" size="xs">
                          Delete
                        </Button>
                      }
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <Field className="w-32">
            <Label htmlFor="m-role">Role</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as ProductMediaRole)}>
              <SelectTrigger id="m-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="min-w-52 flex-1">
            <Label htmlFor="m-alt">Alt text</Label>
            <Input
              id="m-alt"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="Charcoal tee, front, on a hanger"
            />
          </Field>
          <Field>
            <Label htmlFor="m-file" className="sr-only">
              Image
            </Label>
            <label
              htmlFor="m-file"
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-sm border-[1.5px] border-border-strong px-[22px] text-[15px] font-semibold hover:bg-surface-sunken"
            >
              <Upload className="size-4" />
              {uploading ? "Uploading…" : "Choose image"}
            </label>
            <input
              id="m-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </Field>
        </div>

        <Outcome error={uploadError ?? error} done={done} />

        <Hint>
          JPEG, PNG, WebP or AVIF, up to 10 MB. Bytes go to R2 and are streamed back through a
          Worker, so the key never leaves the system and access stays revocable.{" "}
          {status !== "active"
            ? "On the live storefront these images stay dark until the product is active — /media/:id joins on active status, which is what makes withdrawing a product also kill every image link anyone already had."
            : "Withdrawing this product also stops its images being served publicly."}
        </Hint>
      </div>
    </Section>
  );
}
