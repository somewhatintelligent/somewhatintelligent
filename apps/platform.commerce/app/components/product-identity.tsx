/**
 * WHAT THE PRODUCT IS — the photographs, the name, the words, in that order.
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
 *
 * THE ONLY THING AN OPERATOR DECIDES ABOUT AN IMAGE IS WHERE IT SITS. The role
 * control is gone: `cover` / `gallery` / `evidence` asked for a second answer to
 * a question the order already answered, and let the two disagree. Position
 * zero is the cover; the numbers under the thumbnails are the same numbers the
 * shop's filmstrip prints, so what an operator arranges here is literally what a
 * shopper sees.
 */
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImageUp, MoreVertical, Plus, Ruler, Trash2 } from "lucide-react";

import { Button } from "platform.ui/components/button";
import { Field } from "platform.ui/components/field";
import { Input } from "platform.ui/components/input";
import { Label } from "platform.ui/components/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "platform.ui/components/dropdown-menu";
import { Switch } from "platform.ui/components/switch";
import { Textarea } from "platform.ui/components/textarea";

import type { ProductDetail } from "../../domain/Contracts.ts";
import {
  ingestProductMedia,
  putProductSizeGuide,
  removeProductSizeGuide,
  reorderProductMedia,
  saveProductDraft,
} from "../lib/catalog.functions.ts";
import { deleteProductMedia, planProductMediaDeletion } from "../lib/deletion.functions.ts";
import { centsFrom, commandId, dollarsFrom, position, refusalText } from "../lib/format.ts";
import { Hint, Outcome } from "./outcome.tsx";
import { DeletionDialog } from "./deletion-dialog.tsx";

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
    detailsMarkdown: draft.detailsMarkdown ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const dirty =
    form.title !== draft.title ||
    form.slug !== draft.slug ||
    form.descriptionMarkdown !== (draft.descriptionMarkdown ?? "") ||
    form.detailsMarkdown !== (draft.detailsMarkdown ?? "");

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
          /**
           * EMPTY MEANS NO PANEL, and `null` is how that is said on the wire.
           * Saving `""` would publish a `Product details` accordion that opens
           * onto nothing, which is the one thing the storefront must never
           * render — see the omission rule in `Storefront.ts`.
           */
          detailsMarkdown: form.detailsMarkdown.trim() || null,
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

      <div className="flex min-w-0 flex-col gap-4 overflow-auto">
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
            rows={4}
            value={form.descriptionMarkdown}
            onChange={(e) => setForm({ ...form, descriptionMarkdown: e.target.value })}
            placeholder="Markdown. Always visible under the title — shipping and returns go here if you want them said."
            className="min-h-24 flex-1 resize-y"
          />
        </Field>

        {/*
          THE OPTIONAL PANEL, and it is optional all the way down: empty here
          means the product page renders no `Product details` accordion at all,
          rather than an empty one with a chevron that opens onto nothing.
        */}
        <Field className="flex min-h-0 flex-1 flex-col">
          <Label htmlFor="details" className="text-xs">
            Product details
          </Label>
          <Textarea
            id="details"
            rows={3}
            value={form.detailsMarkdown}
            onChange={(e) => setForm({ ...form, detailsMarkdown: e.target.value })}
            placeholder="Markdown. Optional — an accordion on the product page. Leave empty and there is no accordion."
            className="min-h-20 flex-1 resize-y"
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
 * A PRICE PER MARKET, and the per-market kill switch beside it.
 *
 * Two independent numbers in two currencies — the CAD/USD gap is a pricing
 * decision about who absorbs the tariff, never a conversion. The switch is
 * "sold here at all": off keeps the price and stops the selling, which is how
 * the store goes Canada-only without a deploy.
 *
 * Edits land on the DRAFT and change nothing a shopper sees until the next
 * publish freezes them into the release, exactly like the title.
 */
const MARKET_FORM = [
  { code: "CA" as const, label: "Canada", currency: "CAD" },
  { code: "US" as const, label: "United States", currency: "USD" },
];

export function ProductMarkets({
  productId,
  draft,
  markets,
  refresh,
}: {
  productId: string;
  draft: ProductDetail["draft"];
  markets: ProductDetail["markets"];
  refresh: () => Promise<void>;
}) {
  const stored = new Map(markets.map((entry) => [entry.market, entry]));
  const initial = Object.fromEntries(
    MARKET_FORM.map(({ code }) => {
      const row = stored.get(code);
      return [
        code,
        // No row yet reads as "not sold here": price empty, switch off.
        { price: row ? dollarsFrom(row.priceCents) : "", active: row?.active ?? false },
      ];
    }),
  ) as Record<"CA" | "US", { price: string; active: boolean }>;

  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const dirty = MARKET_FORM.some(
    ({ code }) =>
      form[code].price !== initial[code].price || form[code].active !== initial[code].active,
  );

  const save = async (event: React.FormEvent) => {
    event.preventDefault();

    /**
     * Only markets with a price save — an untouched blank row is "still not
     * sold here", not a zero-dollar listing. A blank price with the switch ON
     * is the one shape that cannot mean anything, so it refuses.
     */
    const entries: { market: "CA" | "US"; priceCents: number; active: boolean }[] = [];
    for (const { code, label: marketLabel } of MARKET_FORM) {
      const value = form[code];
      if (value.price.trim() === "") {
        if (value.active) {
          setError(new Error(`${marketLabel} is on but has no price.`));
          return;
        }
        if (stored.has(code)) {
          setError(
            new Error(`${marketLabel} has a saved price — turn it off instead of blanking it.`),
          );
          return;
        }
        continue;
      }
      const priceCents = centsFrom(value.price);
      if (priceCents === null || priceCents < 0) {
        setError(new Error(`${marketLabel} price must be a number of dollars — 45.00`));
        return;
      }
      entries.push({ market: code, priceCents, active: value.active });
    }

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await saveProductDraft({
        data: {
          productId,
          expectedRevision: draft.revision,
          markets: entries,
          commandId: commandId(),
        },
      });
      if (!result.ok) {
        setError(new Error(refusalText(result.error, result.message)));
        return;
      }
      setDone("Markets saved");
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
        <h2 className="text-base font-semibold tracking-tight">Markets</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          A price per market, in its currency. Off means not sold there.
        </p>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-3">
        {MARKET_FORM.map(({ code, label: marketLabel, currency }) => (
          <Field key={code}>
            <div className="flex items-center gap-3">
              <Switch
                id={`market-${code}`}
                checked={form[code].active}
                onCheckedChange={(active) =>
                  setForm({ ...form, [code]: { ...form[code], active } })
                }
                aria-label={`Sell in ${marketLabel}`}
              />
              <Label htmlFor={`market-price-${code}`} className="w-24 shrink-0 text-xs">
                {marketLabel}
              </Label>
              <div className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id={`market-price-${code}`}
                  inputMode="decimal"
                  value={form[code].price}
                  placeholder="—"
                  onChange={(e) =>
                    setForm({ ...form, [code]: { ...form[code], price: e.target.value } })
                  }
                  className="h-11 pl-7 font-display text-lg tnum"
                />
              </div>
              <span className="w-10 shrink-0 text-xs text-muted-foreground">{currency}</span>
            </div>
          </Field>
        ))}
        <div className="flex justify-end">
          <Button type="submit" variant="outline" disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save markets"}
          </Button>
        </div>
      </div>
      <Outcome error={error} done={done} />
    </form>
  );
}

/**
 * THE PHOTOGRAPH, one at a time and large, with its POSITION under it.
 *
 * A grid of thumbnails is the right shape for choosing between images and the
 * wrong one for judging them — at three-to-a-row in a side column each was
 * about the size of a postage stamp, which is not enough to notice that the
 * colour is off.
 *
 * The menu on the image moves it EARLIER or LATER and nothing else, because
 * position is now the whole of what an operator decides: `01` leads the listing
 * and opens the product page, and the rest follow it in the shop's filmstrip in
 * exactly this order. An upload lands at the end, which is the one place a new
 * photograph can go without silently changing which one leads.
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
    body.set("alt", file.name.replace(/\.[^.]+$/, ""));
    body.set("commandId", commandId());
    await act(() => ingestProductMedia({ data: body }));
    // Appended, so follow it to the end of the strip.
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

            {/*
              THE POSITION, stated on the image itself. `01` is the listing
              cover and the shot the product page opens on — an operator should
              not have to count thumbnails to know which one that is.
            */}
            <span className="absolute top-2 left-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium tnum">
              {position(index)}
              {index === 0 ? " · cover" : ""}
            </span>
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
        THE STRIP IS THE NAVIGATION, and it is NUMBERED. Every image is visible
        and one click away, and the number under each is the position the
        storefront prints — so the order an operator sees here is the order a
        shopper gets, with no translation step in between.
      */}
      <div className="flex flex-wrap gap-2">
        {media.map((item, i) => (
          <div key={item.id} className="flex flex-col items-center gap-0.5">
            <button
              type="button"
              onClick={() => setAt(i)}
              aria-label={`Show image ${position(i)}${item.alt ? `, ${item.alt}` : ""}`}
              aria-pressed={i === index}
              className={`relative size-14 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                i === index ? "border-primary" : "border-border hover:border-border-strong"
              }`}
            >
              <img src={item.href} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
            <span className="tnum text-[0.65rem] leading-none text-muted-foreground">
              {position(i)}
            </span>
          </div>
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          aria-label="Add an image at the end"
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

/**
 * THE SIZE GUIDE — one chart, its description, and the fit comments beside it.
 *
 * A PANEL OF ITS OWN because it is not product photography: it never joins the
 * ordered set, is never the listing cover, and a shopper sees it only after
 * opening `Size & fit`. Giving it its own upload rather than a "kind" dropdown
 * on the gallery is what lets `product_image` carry no role column at all.
 *
 * NOTHING HERE GENERATES A CHART, and nothing here dictates what one looks
 * like. The operator uploads the image they made, in any format the store can
 * display; it is drawn at `contain` scale over the sizing background, which
 * works whether or not it has a transparent one of its own. A transparent PNG
 * sits most cleanly on that background — worth SAYING, which the checkerboard
 * preview below does, and not worth refusing an upload over.
 *
 * ALL THREE FIELDS CLEAR TOGETHER on remove, because half a panel is not a
 * state worth being able to reach.
 */
export function ProductSizeGuide({
  productId,
  draft,
  refresh,
}: {
  productId: string;
  draft: ProductDetail["draft"];
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    alt: draft.sizeGuideAlt ?? "",
    notes: draft.sizeGuideNotesMarkdown ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const dirty =
    form.alt !== (draft.sizeGuideAlt ?? "") || form.notes !== (draft.sizeGuideNotesMarkdown ?? "");

  const act = async (
    call: () => Promise<{ ok: boolean; error?: string; message?: string }>,
    success: string,
  ) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await call();
      if (!result.ok) {
        setError(new Error(refusalText(result.error ?? "failed", result.message)));
        return;
      }
      setDone(success);
      await refresh();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File) => {
    const body = new FormData();
    body.set("file", file);
    body.set("productId", productId);
    body.set("commandId", commandId());
    return act(
      () => putProductSizeGuide({ data: body }),
      draft.sizeGuideAssetId ? "Size guide replaced" : "Size guide uploaded",
    );
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    return act(
      () =>
        saveProductDraft({
          data: {
            productId,
            expectedRevision: draft.revision,
            /** Empty is `null`, so the frozen release carries an absence rather than a blank. */
            sizeGuideAlt: form.alt.trim() || null,
            sizeGuideNotesMarkdown: form.notes.trim() || null,
            commandId: commandId(),
          },
        }),
      "Size guide saved",
    );
  };

  return (
    <form
      onSubmit={save}
      className="flex h-full min-h-0 self-stretch flex-col gap-3 overflow-auto rounded-xl border border-border bg-card p-5"
    >
      <div>
        <h2 className="text-base font-semibold tracking-tight">Size guide</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          One image, monochrome line art on transparency. The shop masks it and paints it in the
          page's own ink, so the same file works light-on-dark and dark-on-light. No plate, no{" "}
          <code>Size &amp; fit</code> panel on the product page.
        </p>
      </div>

      <div className="grid min-h-0 gap-3 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/*
          WHAT THE SHOP WILL ACTUALLY DO, on both surfaces it can do it on.

          The storefront masks this file and paints the result in the page's own
          ink — see `.product-sizing-art`. So a preview of the raw upload would
          be a preview of something no shopper ever sees, and the one failure
          worth catching early is invisible in it: a chart with a baked-in
          background, or one in full colour, flattens to a solid slab under a
          mask. Rendering it here the same way makes that obvious before
          publishing rather than after.
        */}
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              {
                label: "On the shop",
                surface: "var(--color-inverse)",
                ink: "var(--color-inverse-foreground)",
              },
              {
                label: "On a light surface",
                surface: "var(--color-inverse-foreground)",
                ink: "var(--color-inverse)",
              },
            ] as const
          ).map(({ label, surface, ink }) => (
            <figure key={label} className="m-0">
              <div
                className="flex aspect-4/3 items-center justify-center overflow-hidden rounded-lg border border-border"
                style={{ backgroundColor: surface, color: ink }}
              >
                {draft.sizeGuideHref ? (
                  <div
                    role="img"
                    aria-label={form.alt || "Size guide preview"}
                    className="h-full w-full"
                    style={{
                      backgroundColor: "currentColor",
                      WebkitMaskImage: `url("${draft.sizeGuideHref}")`,
                      maskImage: `url("${draft.sizeGuideHref}")`,
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                      WebkitMaskPosition: "center",
                      maskPosition: "center",
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => input.current?.click()}
                    className="flex flex-col items-center gap-1.5 p-4 text-center text-sm"
                    style={{ color: ink, opacity: 0.7 }}
                  >
                    <Ruler className="size-6" />
                    Upload a size chart
                  </button>
                )}
              </div>
              <figcaption className="mt-1 text-center text-xs text-muted-foreground">
                {label}
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <Field>
            <Label htmlFor="size-guide-alt" className="text-xs">
              Chart description
            </Label>
            <Textarea
              id="size-guide-alt"
              rows={3}
              value={form.alt}
              onChange={(e) => setForm({ ...form, alt: e.target.value })}
              placeholder="The measurements in words — pit-to-pit 50 cm at S, 53 at M, 56 at L; length 70, 72, 74."
              className="min-h-16 resize-y"
            />
            <Hint>
              This is the alt text. A screen reader gets this instead of the chart, so it has to
              carry the numbers rather than say &ldquo;sizing chart&rdquo;.
            </Hint>
          </Field>

          <Field>
            <Label htmlFor="size-guide-notes" className="text-xs">
              Fit comments
            </Label>
            <Textarea
              id="size-guide-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Markdown. Shown beside the chart — relaxed unisex fit, model is 170 cm and wears M."
              className="min-h-16 resize-y"
            />
          </Field>
        </div>
      </div>

      <input
        ref={input}
        type="file"
        /** The store's display allowlist — the same one product photography takes. */
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />

      <div className="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <Outcome error={error} done={done} />
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <ImageUp className="size-4" />
          {draft.sizeGuideAssetId ? "Replace plate" : "Upload plate"}
        </Button>
        {draft.sizeGuideAssetId ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act(
                () => removeProductSizeGuide({ data: { productId, commandId: commandId() } }),
                "Size guide removed from the draft",
              )
            }
          >
            <Trash2 className="size-4" />
            Remove
          </Button>
        ) : null}
        <Button type="submit" variant={dirty ? "default" : "outline"} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save size guide"}
        </Button>
      </div>
    </form>
  );
}
