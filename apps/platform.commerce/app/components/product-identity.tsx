/**
 * WHAT THE PRODUCT IS — the photograph, the name, the words, in that order.
 *
 * This replaces a "Draft" form and a "Media" panel that sat in different
 * columns, which is the shape the DATABASE has (a `product_draft` row and a
 * `product_image` table) rather than the shape a product has. Nobody opens a
 * product to edit a draft row; they open it to look at the thing and check what
 * it is called.
 *
 * So the image leads at the size you can actually judge it at, the title is set
 * in the display face rather than as a form field among equals, and the slug
 * sits under it as the quiet consequence of the title it is derived from.
 */
import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
  ImageUp,
  MoreVertical,
  Plus,
  Star,
  Trash2,
} from "lucide-react";

import { Button } from "platform.ui/components/button";
import { Field } from "platform.ui/components/field";
import { Input } from "platform.ui/components/input";
import { Label } from "platform.ui/components/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "platform.ui/components/dropdown-menu";
import { Textarea } from "platform.ui/components/textarea";

import type { ProductDetail, ProductMediaRole } from "../../domain/Contracts.ts";
import {
  ingestProductMedia,
  reorderProductMedia,
  saveProductDraft,
  setProductMediaRole,
} from "../lib/catalog.functions.ts";
import { deleteProductMedia, planProductMediaDeletion } from "../lib/deletion.functions.ts";
import { centsFrom, commandId, dollarsFrom, refusalText } from "../lib/format.ts";
import { Outcome } from "./outcome.tsx";
import { DeletionDialog } from "./deletion-dialog.tsx";

const ROLES: ProductMediaRole[] = ["cover", "gallery", "evidence"];

export function Identity({
  productId,
  draft,
  media,
  refresh,
}: {
  productId: string;
  draft: ProductDetail["draft"];
  media: ProductDetail["media"];
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    title: draft.title,
    slug: draft.slug,
    descriptionMarkdown: draft.descriptionMarkdown ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const dirty =
    form.title !== draft.title ||
    form.slug !== draft.slug ||
    form.descriptionMarkdown !== (draft.descriptionMarkdown ?? "");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await saveProductDraft({
        data: {
          productId,
          /** From the read this form rendered from — that is the whole guard. */
          expectedRevision: draft.revision,
          title: form.title,
          slug: form.slug,
          descriptionMarkdown: form.descriptionMarkdown || null,
          commandId: commandId(),
        },
      });
      if (!result.ok) {
        setError(new Error(refusalText(result.error, result.message)));
        return;
      }
      setDone("Saved");
      await refresh();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={save}
      className="grid min-w-0 self-start gap-5 rounded-xl border border-border bg-card p-5 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-6 xl:h-full xl:min-h-0 xl:self-stretch xl:overflow-hidden"
    >
      <Gallery productId={productId} media={media} refresh={refresh} />

      <div className="flex min-w-0 flex-col gap-4">
        <Field>
          <Label htmlFor="title" className="sr-only">
            Title
          </Label>
          <Input
            id="title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Charcoal Tee"
            className="h-auto w-full border-0 px-0 font-display text-2xl font-semibold tracking-tight shadow-none focus-visible:ring-0"
          />
        </Field>

        <Field>
          <Label htmlFor="slug" className="text-xs">
            Address
          </Label>
          <div className="flex items-baseline gap-1 text-sm text-muted-foreground">
            <span>/</span>
            <Input
              id="slug"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="h-9 min-w-0 flex-1"
            />
          </div>
        </Field>

        <Field className="flex min-h-0 flex-1 flex-col">
          <Label htmlFor="description" className="text-xs">
            Description
          </Label>
          <Textarea
            id="description"
            rows={5}
            value={form.descriptionMarkdown}
            onChange={(e) => setForm({ ...form, descriptionMarkdown: e.target.value })}
            placeholder="Markdown. Shown on the product page."
            className="min-h-32 flex-1 resize-y"
          />
        </Field>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
          <Outcome error={error} done={done} />
          <Button type="submit" variant={dirty ? "default" : "outline"} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save details"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * PRICE IS PRODUCT-LEVEL, not a variant column. It gets its own small card so
 * it remains prominent without narrowing the title, address and description
 * fields beside the gallery.
 */
export function ProductPrice({
  productId,
  draft,
  refresh,
}: {
  productId: string;
  draft: ProductDetail["draft"];
  refresh: () => Promise<void>;
}) {
  const [price, setPrice] = useState(dollarsFrom(draft.priceCents));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const dirty = price !== dollarsFrom(draft.priceCents);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const priceCents = centsFrom(price);
    if (priceCents === null || priceCents < 0) {
      setError(new Error("Price must be a number of dollars — 45.00"));
      return;
    }

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await saveProductDraft({
        data: {
          productId,
          expectedRevision: draft.revision,
          priceCents,
          commandId: commandId(),
        },
      });
      if (!result.ok) {
        setError(new Error(refusalText(result.error, result.message)));
        return;
      }
      setDone("Price saved");
      await refresh();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={save}
      className="flex h-full min-h-0 self-stretch flex-col overflow-auto rounded-xl border border-border bg-card p-5"
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold tracking-tight">Price</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">One price across every variant.</p>
      </div>
      <div className="flex flex-1 items-center">
        <Field className="w-full">
          <Label htmlFor="price" className="sr-only">
            Price in dollars
          </Label>
          <div className="flex items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-muted-foreground">
                $
              </span>
              <Input
                id="price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="h-14 pl-7 font-display text-2xl tnum"
              />
            </div>
            <Button type="submit" variant="outline" disabled={busy || !dirty} className="h-14">
              {busy ? "Saving…" : "Save price"}
            </Button>
          </div>
        </Field>
      </div>
      <Outcome error={error} done={done} />
    </form>
  );
}

/**
 * THE PHOTOGRAPH, one at a time and large.
 *
 * A grid of thumbnails is the right shape for choosing between images and the
 * wrong one for judging them — at three-to-a-row in a side column each was
 * about the size of a postage stamp, which is not enough to notice that the
 * colour is off.
 *
 * The role control acts on THE IMAGE ON SCREEN rather than on a row in a list,
 * which is why `setProductMediaRole` had to exist: the role was previously
 * fixed at upload, so the cover could only be chosen by deleting and
 * re-uploading in the right order.
 */
function Gallery({
  productId,
  media,
  refresh,
}: {
  productId: string;
  media: ProductDetail["media"];
  refresh: () => Promise<void>;
}) {
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const index = Math.min(at, Math.max(0, media.length - 1));
  const current = media[index];

  const act = async (call: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await call();
      if (!result.ok) {
        setError(new Error(refusalText(result.error ?? "failed", result.message)));
        return;
      }
      await refresh();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    const body = new FormData();
    body.set("file", file);
    body.set("productId", productId);
    // The FIRST image is the cover by default, because a product with images
    // and no cover publishes into a listing with no picture.
    body.set("role", media.length === 0 ? "cover" : "gallery");
    body.set("alt", file.name.replace(/\.[^.]+$/, ""));
    body.set("commandId", commandId());
    await act(() => ingestProductMedia({ data: body }));
    setAt(media.length);
  };

  /** Move the shown image one place, and follow it. */
  const shift = async (by: -1 | 1) => {
    const next = [...media];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setAt(target);
    await act(() =>
      reorderProductMedia({
        data: { productId, mediaIds: next.map((m) => m.id), commandId: commandId() },
      }),
    );
  };

  return (
    <div className="flex w-full flex-none flex-col gap-2.5 lg:w-[19rem] xl:min-h-0 xl:self-stretch">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void upload(file);
        }}
        className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border xl:min-h-0 xl:flex-1 xl:aspect-auto ${
          dragging ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        {current ? (
          <>
            <img
              src={current.href}
              alt={current.alt}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            {/*
              ONE MENU, not a row of icon buttons. The reorder controls used to
              wear the same chevron as the arrows on the image, so the button
              you pressed to see the next photograph silently changed which one
              leads.
            */}
            <div className="absolute top-2 right-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button size="icon-sm" variant="secondary" aria-label="Image options">
                      <MoreVertical className="size-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  {/*
                    A RADIO GROUP, and not only because Base UI demands one.
                    `DropdownMenuLabel` is `Menu.GroupLabel`, which throws
                    `MenuGroupContext is missing` outside a group — but the fix
                    is not to wrap plain items in `Menu.Group`. An image has
                    exactly one role, so this is a single-select: the radio
                    group states that in the accessibility tree, renders the
                    checked mark itself, and replaces the hand-rolled `Check`
                    that only looked like one.
                  */}
                  <DropdownMenuRadioGroup
                    value={current.role}
                    onValueChange={(next) =>
                      void act(() =>
                        setProductMediaRole({
                          data: {
                            productId,
                            mediaId: current.id,
                            role: next as ProductMediaRole,
                            commandId: commandId(),
                          },
                        }),
                      )
                    }
                  >
                    <DropdownMenuLabel>Role</DropdownMenuLabel>
                    {ROLES.map((role) => (
                      <DropdownMenuRadioItem key={role} value={role} disabled={busy}>
                        {role === "cover" ? (
                          <Star className="size-4" />
                        ) : (
                          <ImageIcon className="size-4" />
                        )}
                        {role}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={busy || index === 0} onClick={() => void shift(-1)}>
                    <ArrowLeft className="size-4" />
                    Move earlier
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy || index === media.length - 1}
                    onClick={() => void shift(1)}
                  >
                    <ArrowRight className="size-4" />
                    Move later
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setConfirming(true)}>
                    <Trash2 className="size-4" />
                    Delete image
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {current.role === "cover" ? (
              <span className="absolute top-2 left-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium">
                Cover
              </span>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex flex-col items-center gap-1.5 p-6 text-center text-sm text-muted-foreground"
          >
            <ImageUp className="size-7" />
            Drop an image, or click to choose
            <span className="text-xs">Publish refuses without one</span>
          </button>
        )}
      </div>

      {/*
        THE STRIP IS THE NAVIGATION. Every image is visible and one click away,
        which is what carousel arrows were standing in for badly — and the
        selected one is ringed rather than counted.
      */}
      <div className="flex flex-wrap gap-2">
        {media.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAt(i)}
            aria-label={`Show ${item.alt || `image ${i + 1}`}`}
            className={`relative size-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
              i === index ? "border-primary" : "border-border hover:border-border-strong"
            }`}
          >
            <img src={item.href} alt="" className="h-full w-full object-cover" loading="lazy" />
            {item.role === "cover" ? (
              <span className="absolute inset-x-0 bottom-0 bg-background/85 text-center text-[0.6rem] leading-tight">
                cover
              </span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          aria-label="Add an image"
          className="flex size-14 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />

      {media.length > 0 && !media.some((item) => item.role === "cover") ? (
        <p className="text-xs text-warning">
          No image is set as the cover, so a listing would show no picture. Publish still accepts
          it.
        </p>
      ) : null}

      {current && confirming ? (
        <DeletionDialog
          label="image"
          open={confirming}
          onOpenChange={setConfirming}
          plan={() =>
            planProductMediaDeletion({
              data: { productId, mediaId: current.id, commandId: commandId() },
            })
          }
          confirm={(payload) => deleteProductMedia({ data: payload })}
          onDeleted={async () => {
            setConfirming(false);
            setAt(0);
            await refresh();
          }}
        />
      ) : null}

      <Outcome error={error} />
    </div>
  );
}
