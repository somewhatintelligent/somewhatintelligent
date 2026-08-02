import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@si/ui/components/dialog";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Field, FieldDescription, FieldError } from "@si/ui/components/field";
import { Alert } from "@si/ui/components/alert";
import { updateOrgAsOperator } from "@/lib/org-admin.functions";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Same kebab-case reduction as orgs/new.tsx — kept local rather than shared
// since the two forms (create vs. rename) have deliberately independent
// touched/reset lifecycles.
function kebabize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function EditOrgDialog({
  orgId,
  currentName,
  currentSlug,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string;
  currentName: string;
  currentSlug: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSuccess: (org: { name: string; slug: string }) => void;
}) {
  const [name, setName] = useState(currentName);
  const [slug, setSlug] = useState(currentSlug);
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);

  // Reset to the current org values whenever the dialog opens, so re-opening
  // after a prior edit (or a different row) doesn't carry stale state.
  useEffect(() => {
    if (open) {
      setName(currentName);
      setSlug(currentSlug);
      setSlugTouched(false);
      setError(null);
      setSlugError(null);
    }
  }, [open, currentName, currentSlug]);

  // Auto-suggest slug from name, exactly like orgs/new.tsx — but only until
  // the operator touches the slug field directly.
  useEffect(() => {
    if (!slugTouched) {
      setSlug(kebabize(name));
    }
  }, [name, slugTouched]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSlugError(null);

    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    if (!SLUG_PATTERN.test(slug)) {
      setSlugError("Slug must be lowercase letters, digits, and single hyphens.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await updateOrgAsOperator({
        data: { orgId, name: name.trim(), slug },
      });
      if (!result.ok) {
        if (result.error === "slug_taken") {
          setSlugError("This slug is already taken.");
        } else {
          setError(result.message);
        }
        setSubmitting(false);
        return;
      }
      onSuccess(result.organization);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit organization</DialogTitle>
          <DialogDescription>
            Renames apply to sign-in and admin surfaces immediately.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <Label htmlFor="edit-org-name">Organization name</Label>
            <Input
              id="edit-org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={60}
              required
              autoFocus
            />
            <FieldDescription>The human-readable display name (2–60 chars).</FieldDescription>
          </Field>

          <Field>
            <Label htmlFor="edit-org-slug">Slug</Label>
            <Input
              id="edit-org-slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
                setSlugError(null);
              }}
              pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
              minLength={2}
              maxLength={48}
              required
              aria-invalid={slugError ? true : undefined}
            />
            <FieldDescription>
              URL: <code className="font-mono">/o/{slug || "<slug>"}/...</code>
            </FieldDescription>
            {slugError && <FieldError errors={[{ message: slugError }]} />}
          </Field>

          {error && <Alert variant="destructive">{error}</Alert>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
