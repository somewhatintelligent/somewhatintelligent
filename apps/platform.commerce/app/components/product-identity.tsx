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
import { ChevronLeft, ChevronRight, ImageUp, Trash2 } from "lucide-react";

import { Badge } from "platform.ui/components/badge";
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
    price: dollarsFrom(draft.priceCents),
    descriptionMarkdown: draft.descriptionMarkdown ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const priceCents = centsFrom(form.price);
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
          /** From the read this form rendered from — that is the whole guard. */
          expectedRevision: draft.revision,
          title: form.title,
          slug: form.slug,
          priceCents,
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
      className="flex flex-col gap-4 self-start rounded-md border border-border bg-card p-4 lg:flex-row lg:gap-6"
    >
      <Gallery productId={productId} media={media} refresh={refresh} />

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Field>
          <Label htmlFor="title" className="sr-only">
            Title
          </Label>
          <Input
            id="title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Charcoal Tee"
            className="h-auto border-0 px-0 font-display text-2xl font-semibold tracking-tight shadow-none focus-visible:ring-0"
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
              className="h-8 flex-1"
            />
          </div>
        </Field>

        <Field className="flex-1">
          <Label htmlFor="description" className="text-xs">
            Description
          </Label>
          <Textarea
            id="description"
            rows={5}
            value={form.descriptionMarkdown}
            onChange={(e) => setForm({ ...form, descriptionMarkdown: e.target.value })}
            placeholder="Markdown. Shown on the product page."
          />
        </Field>
      </div>

      <div className="flex w-full flex-col gap-3 lg:w-40">
        <Field>
          <Label htmlFor="price" className="text-xs">
            Price
          </Label>
          <Input
            id="price"
            inputMode="decimal"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            className="font-display text-lg"
          />
        </Field>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Saving…" : "Save"}
        </Button>

        <Outcome error={error} done={done} />
      </div>
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
    <div className="flex w-full flex-none flex-col gap-2 lg:w-72">
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
        className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border-2 ${
          dragging ? "border-primary bg-primary/5" : "border-dashed border-border"
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
            {media.length > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={() => setAt(index === 0 ? media.length - 1 : index - 1)}
                  className="absolute top-1/2 left-1.5 -translate-y-1/2 rounded-full bg-background/85 p-1.5 hover:bg-background"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next image"
                  onClick={() => setAt(index === media.length - 1 ? 0 : index + 1)}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full bg-background/85 p-1.5 hover:bg-background"
                >
                  <ChevronRight className="size-4" />
                </button>
              </>
            ) : null}
            <span className="absolute top-1.5 left-1.5">
              <Badge variant={current.role === "cover" ? "default" : "outline"} size="sm">
                {current.role}
              </Badge>
            </span>
            {media.length > 1 ? (
              <span className="tnum absolute right-1.5 bottom-1.5 rounded-full bg-background/85 px-2 py-0.5 text-xs">
                {index + 1}/{media.length}
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

      {current ? (
        <div className="flex items-center gap-1.5">
          <Select
            value={current.role}
            onValueChange={(role) =>
              role &&
              void act(() =>
                setProductMediaRole({
                  data: {
                    productId,
                    mediaId: current.id,
                    role: role as ProductMediaRole,
                    commandId: commandId(),
                  },
                }),
              )
            }
          >
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={busy || index === 0}
            onClick={() => void shift(-1)}
            title="Move earlier"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={busy || index === media.length - 1}
            onClick={() => void shift(1)}
            title="Move later"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => input.current?.click()}
            title="Add an image"
          >
            <ImageUp className="size-4" />
          </Button>
          <DeletionDialog
            label="image"
            plan={() =>
              planProductMediaDeletion({
                data: { productId, mediaId: current.id, commandId: commandId() },
              })
            }
            confirm={(payload) => deleteProductMedia({ data: payload })}
            onDeleted={async () => {
              setAt(0);
              await refresh();
            }}
            trigger={
              <Button type="button" size="icon-sm" variant="ghost" title="Delete image">
                <Trash2 className="size-4" />
              </Button>
            }
          />
        </div>
      ) : null}

      <Outcome error={error} />
    </div>
  );
}
