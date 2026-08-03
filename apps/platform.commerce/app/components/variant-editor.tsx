/**
 * EDITING AN EXISTING VARIANT — size, SKU, mode and ship date.
 *
 * NO STOCK FIELD, and the omission is the design. `putVariant` writes stock
 * ABSOLUTELY, from whatever the form was rendered with, and that value is stale
 * the moment a checkout lands — so a form that carried it would roll inventory
 * back every time someone fixed a typo. Units move through `adjustStock`'s
 * guarded relative delta, which is the ± control in the table.
 *
 * That split is why this is a separate control from the add-a-variant form
 * below it rather than one "add or update" form doing both jobs: creating needs
 * an opening stock, editing must never touch it.
 */
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";

import { Button } from "platform.ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "platform.ui/components/dialog";
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

import type { ProductVariantDTO } from "../../domain/Contracts.ts";
import { putVariant } from "../lib/catalog.functions.ts";
import { commandId, refusalText } from "../lib/format.ts";
import { Outcome } from "./outcome.tsx";

/** `YYYY-MM-DD` for a date input, in the browser's own zone. */
const dateValue = (at: number | null): string => {
  if (at === null) return "";
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function VariantEditor({
  productId,
  variant,
  onSaved,
}: {
  productId: string;
  variant: ProductVariantDTO;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState({
    size: variant.size,
    sku: variant.sku,
    mode: variant.mode,
    expectedShipAt: dateValue(variant.expectedShipAt),
  });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      // Re-seed from the row every time, so a dialog opened after someone
      // else's edit shows theirs rather than a stale first render.
      setForm({
        size: variant.size,
        sku: variant.sku,
        mode: variant.mode,
        expectedShipAt: dateValue(variant.expectedShipAt),
      });
      setError(null);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await putVariant({
        data: {
          productId,
          /**
           * THE FIELD THIS CONTROL EXISTS FOR. Without it `putVariant` takes
           * its create branch and refuses with `sku_taken` against the row it
           * was meant to edit.
           */
          variantId: variant.id,
          size: form.size.trim(),
          sku: form.sku.trim(),
          mode: form.mode,
          expectedShipAt:
            form.mode === "preorder" && form.expectedShipAt
              ? new Date(form.expectedShipAt).getTime()
              : null,
          commandId: commandId(),
        },
      });
      if (!result.ok) {
        setError(new Error(refusalText(result.error, result.message)));
        return;
      }
      setOpen(false);
      await onSaved();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => onOpenChange(true)}>
        <Pencil />
        Edit
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {variant.size}</DialogTitle>
            <DialogDescription>
              Stock is not here — use the ± controls in the table, which move it by a relative
              amount so a concurrent sale cannot be overwritten.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={save} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="edit-size">Size</Label>
                <Input
                  id="edit-size"
                  value={form.size}
                  onChange={(e) => setForm({ ...form, size: e.target.value })}
                  required
                />
              </Field>
              <Field>
                <Label htmlFor="edit-sku">SKU</Label>
                <Input
                  id="edit-sku"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  required
                />
                <FieldDescription>Unique across every product.</FieldDescription>
              </Field>
            </div>

            <Field>
              <Label htmlFor="edit-mode">Mode</Label>
              <Select
                value={form.mode}
                onValueChange={(v) => v && setForm({ ...form, mode: v as "stock" | "preorder" })}
              >
                <SelectTrigger id="edit-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">stock — units you have</SelectItem>
                  <SelectItem value="preorder">preorder — places in a run</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                A pre-order size also needs a run cap on the product, or every checkout is refused.
                Setting one is how you go live.
              </FieldDescription>
            </Field>

            {form.mode === "preorder" ? (
              <Field>
                <Label htmlFor="edit-ship">Expected ship date</Label>
                <Input
                  id="edit-ship"
                  type="date"
                  value={form.expectedShipAt}
                  onChange={(e) => setForm({ ...form, expectedShipAt: e.target.value })}
                />
                <FieldDescription>What the buyer is told before they pay.</FieldDescription>
              </Field>
            ) : null}

            <Outcome error={error} />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * ADDING A SIZE, in a dialog rather than a row of fields under the table.
 *
 * Inline, it doubled the panel's height for something used a handful of times
 * per product and never again — and it sat below the table, so the control that
 * fills an empty table was hidden underneath the empty table.
 *
 * NEITHER MODE NOR STOCK IS ASKED FOR ON A RUN. Both are already decided: the
 * product sells as a run of N, so a new size joins that run with the run's
 * headroom. "How many smalls" is the number a run exists to discover, not one
 * to type.
 */
export function AddSize({
  productId,
  slug,
  runCap,
  onAdded,
}: {
  productId: string;
  slug: string;
  runCap: number | null;
  onAdded: () => Promise<void>;
}) {
  const isRun = runCap !== null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState({ size: "", sku: "", stock: "10", expectedShipAt: "" });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setForm({ size: "", sku: "", stock: "10", expectedShipAt: "" });
      setError(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const size = form.size.trim();
    if (!size) return;
    setBusy(true);
    setError(null);
    try {
      const result = await putVariant({
        data: {
          productId,
          size,
          // Derived rather than demanded — it has to be unique globally, which
          // `slug-size` is.
          sku: form.sku.trim() || `${slug}-${size}`.toLowerCase(),
          stock: isRun ? runCap : Number(form.stock) || 0,
          mode: isRun ? "preorder" : "stock",
          expectedShipAt:
            isRun && form.expectedShipAt ? new Date(form.expectedShipAt).getTime() : null,
          commandId: commandId(),
        },
      });
      if (!result.ok) {
        setError(new Error(refusalText(result.error, result.message)));
        return;
      }
      setOpen(false);
      await onAdded();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="xs" onClick={() => onOpenChange(true)}>
        <Plus />
        Add size
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add a size</DialogTitle>
            <DialogDescription>
              {isRun
                ? `Joins the run of ${runCap}. Any size mix, capped in total.`
                : "Sells what you give it, and runs out on its own."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="add-size">Size</Label>
                <Input
                  id="add-size"
                  autoFocus
                  value={form.size}
                  onChange={(e) => setForm({ ...form, size: e.target.value })}
                  placeholder="M"
                  required
                />
              </Field>
              {isRun ? (
                <Field>
                  <Label htmlFor="add-ship">Expected ship</Label>
                  <Input
                    id="add-ship"
                    type="date"
                    value={form.expectedShipAt}
                    onChange={(e) => setForm({ ...form, expectedShipAt: e.target.value })}
                  />
                </Field>
              ) : (
                <Field>
                  <Label htmlFor="add-stock">In stock</Label>
                  <Input
                    id="add-stock"
                    inputMode="numeric"
                    value={form.stock}
                    onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  />
                </Field>
              )}
            </div>

            <Field>
              <Label htmlFor="add-sku">SKU</Label>
              <Input
                id="add-sku"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder={`${slug}-${form.size.trim().toLowerCase() || "m"}`}
              />
              <FieldDescription>Leave blank to derive it from the slug and size.</FieldDescription>
            </Field>

            <Outcome error={error} />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !form.size.trim()}>
                {busy ? "Adding…" : "Add size"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
