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
import { Field, FieldDescription } from "@si/ui/components/field";
import { Alert } from "@si/ui/components/alert";
import { toast } from "@si/ui/components/sonner";
import { authClient } from "@/lib/auth-client";
import type { AdminUser } from "@/lib/admin-users.functions";

// The username plugin contract — same rule the self-service editor enforces
// (components/account/edit-username-dialog.tsx); admin edits must not be able
// to persist handles that break username sign-in.
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,30}$/;

export function EditUserDialog({
  user,
  open,
  onOpenChange,
  onSuccess,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [username, setUsername] = useState(user.username ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(user.name);
      setEmail(user.email);
      setUsername(user.username ?? "");
      setError(null);
    }
  }, [open, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const data: Record<string, string> = {};
    if (name.trim() && name.trim() !== user.name) data.name = name.trim();
    if (email.trim() && email.trim() !== user.email) data.email = email.trim();
    const nextUsername = username.trim();
    if (nextUsername && nextUsername !== (user.username ?? "")) {
      if (!USERNAME_PATTERN.test(nextUsername)) {
        setError("Username must be 3–30 characters: letters, digits, dots, and underscores only.");
        return;
      }
      data.username = nextUsername;
    }

    if (Object.keys(data).length === 0) {
      onOpenChange(false);
      return;
    }

    setSubmitting(true);
    const result = await authClient.admin.updateUser({ userId: user.id, data });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message ?? "Failed to update user");
      return;
    }
    toast.success("User updated");
    onSuccess();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>
            Change this user&apos;s profile details. Fields left as-is are not touched.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <Label htmlFor="edit-user-name">Name</Label>
            <Input
              id="edit-user-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>

          <Field>
            <Label htmlFor="edit-user-email">Email</Label>
            <Input
              id="edit-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <FieldDescription>
              Changing the email does not re-run verification — mark it verified separately if
              needed.
            </FieldDescription>
          </Field>

          <Field>
            <Label htmlFor="edit-user-username">Username</Label>
            <Input
              id="edit-user-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="(none)"
            />
            <FieldDescription>
              Letters, digits, dots, and underscores only — 3 to 30 characters.
            </FieldDescription>
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
