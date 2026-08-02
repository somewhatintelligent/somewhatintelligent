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
import { generatePassword } from "@/lib/generate-password";

export function SetPasswordDialog({
  userId,
  userEmail,
  open,
  onOpenChange,
}: {
  userId: string;
  userEmail: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
      setDone(false);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    const result = await authClient.admin.setUserPassword({ userId, newPassword: password });
    setSubmitting(false);
    if (result.error) {
      setError(result.error.message ?? "Failed to set password");
      return;
    }
    setDone(true);
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      toast.success("Password copied to clipboard");
    } catch {
      toast.error("Could not copy — select and copy manually");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set password</DialogTitle>
          <DialogDescription>
            Replace the password for <strong className="text-foreground">{userEmail}</strong>. It
            takes effect immediately; existing sessions stay alive unless you revoke them.
          </DialogDescription>
        </DialogHeader>

        {!done ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field>
              <Label htmlFor="set-password-value">New password</Label>
              <div className="flex gap-2">
                <Input
                  id="set-password-value"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPassword(generatePassword())}
                >
                  Generate
                </Button>
              </div>
              <FieldDescription>
                Minimum 8 characters. Shown in plain text so you can hand it to the user.
              </FieldDescription>
            </Field>

            {error && <Alert variant="destructive">{error}</Alert>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || password.length === 0}>
                {submitting ? "Setting…" : "Set password"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <Alert variant="success">Password updated for {userEmail}.</Alert>
            <Field>
              <Label>New password</Label>
              <div className="rounded-sm bg-surface-sunken px-3 py-2">
                <code className="type-code block break-all text-primary">{password}</code>
              </div>
              <FieldDescription>
                Copy it now — it is not retrievable after this dialog closes.
              </FieldDescription>
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={copyPassword}>
                Copy password
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
