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
import { Label } from "@si/ui/components/label";
import { Field, FieldDescription } from "@si/ui/components/field";
import { Alert } from "@si/ui/components/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@si/ui/components/avatar";
import { SearchCombobox } from "@si/ui/components/search-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@si/ui/components/select";
import { addOrgMember, searchUsersByEmail, type UserSearchHit } from "@/lib/org-admin.functions";

type Role = "owner" | "admin" | "member";

export function AddMemberModal({
  orgId,
  open,
  onOpenChange,
  onSuccess,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSuccess: () => void;
}) {
  const [pickedUser, setPickedUser] = useState<UserSearchHit | null>(null);
  const userId = pickedUser?.id ?? null;
  const [role, setRole] = useState<Role>("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the modal opens.
  useEffect(() => {
    if (open) {
      setPickedUser(null);
      setRole("member");
      setError(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!userId) {
      setError("Pick an existing user from the dropdown.");
      return;
    }
    setSubmitting(true);
    try {
      await addOrgMember({ data: { orgId, userId, role } });
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Add an existing user to this organization. They get access immediately.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <Label htmlFor="add-member-email">Email</Label>
            <SearchCombobox<UserSearchHit>
              id="add-member-email"
              inputType="email"
              value={pickedUser}
              onSelect={setPickedUser}
              search={async (q) => (await searchUsersByEmail({ data: { email: q } })).users}
              itemToKey={(u) => u.id}
              itemToLabel={(u) => u.email}
              renderItem={(u) => (
                <div className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-sunken">
                  <Avatar size="sm">
                    {u.image ? <AvatarImage src={u.image} alt="" /> : null}
                    <AvatarFallback>{(u.name ?? u.email).charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{u.name ?? "—"}</div>
                    <div className="font-mono text-xs text-muted-foreground/80">{u.email}</div>
                  </div>
                </div>
              )}
              placeholder="user@example.com"
            />
            <FieldDescription>Only existing users are eligible.</FieldDescription>
          </Field>

          <Field>
            <Label htmlFor="add-member-role">Role</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as Role)}>
              <SelectTrigger id="add-member-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {error && <Alert variant="destructive">{error}</Alert>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !userId}>
              {submitting ? "Adding…" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
