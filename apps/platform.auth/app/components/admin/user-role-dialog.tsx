import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "platform.ui/components/dialog";
import { Button } from "platform.ui/components/button";
import { Label } from "platform.ui/components/label";
import { Field, FieldDescription } from "platform.ui/components/field";
import { Alert } from "platform.ui/components/alert";
import { Checkbox } from "platform.ui/components/checkbox";
import { toast } from "platform.ui/components/sonner";
import { hasRole } from "@/lib/session";
import { authClient } from "@/lib/auth-client";
import { AVAILABLE_ROLES, DEFAULT_ROLE, type PlatformRole } from "@/components/admin/roles";

/**
 * The declared roles present in the user's (possibly csv) role value, in
 * declared order — better-auth stores multi-role as a comma-separated
 * string, so membership is checked per role, never `===`.
 */
function resolveRoles(currentRole: string | null | undefined): PlatformRole[] {
  const held = AVAILABLE_ROLES.filter((r) => hasRole(currentRole, r));
  return held.length > 0 ? held : [DEFAULT_ROLE];
}

function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((r) => b.includes(r));
}

export function UserRoleDialog({
  userId,
  userEmail,
  currentRole,
  open,
  onOpenChange,
  onSuccess,
}: {
  userId: string;
  userEmail: string;
  currentRole: string | null | undefined;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSuccess: () => void;
}) {
  const initialRoles = resolveRoles(currentRole);
  const [roles, setRoles] = useState<PlatformRole[]>(initialRoles);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRoles(resolveRoles(currentRole));
      setError(null);
    }
  }, [open, currentRole]);

  function toggleRole(role: PlatformRole, checked: boolean) {
    // Rebuild in declared order so the stored csv stays deterministic.
    setRoles((prev) => AVAILABLE_ROLES.filter((r) => (r === role ? checked : prev.includes(r))));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await authClient.admin.setRole({ userId, role: roles });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message ?? "Failed to change roles");
      return;
    }
    toast.success(`Roles set to ${roles.join(", ")}`);
    onSuccess();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change roles</DialogTitle>
          <DialogDescription>
            Set the platform roles for <strong className="text-foreground">{userEmail}</strong>. A
            user can hold several at once.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <div className="flex flex-col gap-2" role="group" aria-label="Roles">
              {AVAILABLE_ROLES.map((r) => (
                <div key={r} className="flex items-center gap-2">
                  <Checkbox
                    id={`role-${r}`}
                    checked={roles.includes(r)}
                    onCheckedChange={(v) => toggleRole(r, v === true)}
                  />
                  <Label htmlFor={`role-${r}`}>{r.charAt(0).toUpperCase() + r.slice(1)}</Label>
                </div>
              ))}
            </div>
            <FieldDescription>
              Admin grants the full operator surface: user, organization, and OAuth-client
              administration.
            </FieldDescription>
          </Field>

          {error && <Alert variant="destructive">{error}</Alert>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || roles.length === 0 || sameRoles(roles, initialRoles)}
            >
              {submitting ? "Saving…" : "Change roles"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
