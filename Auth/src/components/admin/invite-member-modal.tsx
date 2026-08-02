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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@si/ui/components/select";
import { toast } from "@si/ui/components/sonner";
import { createOrgInvitation } from "@/lib/org-admin.functions";

type Role = "owner" | "admin" | "member";

export function InviteMemberModal({
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
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail("");
      setRole("member");
      setError(null);
      setAcceptUrl(null);
      setEmailSent(false);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { invitationId, emailSent: sent } = await createOrgInvitation({
        data: { orgId, email: email.trim(), role },
      });
      const base = import.meta.env.IDENTITY_URL || window.location.origin;
      setAcceptUrl(`${base}/orgs/accept/${invitationId}`);
      setEmailSent(sent);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyAcceptUrl() {
    if (!acceptUrl) return;
    try {
      await navigator.clipboard.writeText(acceptUrl);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Could not copy — select and copy manually");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite by email</DialogTitle>
          <DialogDescription>
            Generate an invitation for someone who may not have an account yet.
          </DialogDescription>
        </DialogHeader>

        {!acceptUrl ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field>
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="invitee@example.com"
                required
                autoFocus
              />
              <FieldDescription>
                Operator-issued invitations don&apos;t auto-send email. Copy the link on the next
                screen and send it manually.
              </FieldDescription>
            </Field>

            <Field>
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(v) => v && setRole(v as Role)}>
                <SelectTrigger id="invite-role" className="w-full">
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
              <Button type="submit" disabled={submitting || !email}>
                {submitting ? "Creating…" : "Create invitation"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <Alert variant="success">
              {emailSent
                ? "Invitation email sent. You can also copy the link:"
                : `Invitation created. Send the link below to ${email}.`}
            </Alert>
            <Field>
              <Label>Accept URL</Label>
              <div className="rounded-sm bg-surface-sunken px-3 py-2">
                <code className="type-code block break-all text-primary">{acceptUrl}</code>
              </div>
              {!emailSent && (
                <FieldDescription>
                  Email delivery for operator-issued invitations is intentionally manual. The
                  invitee visits this URL to accept.
                </FieldDescription>
              )}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={copyAcceptUrl}>
                Copy link
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
