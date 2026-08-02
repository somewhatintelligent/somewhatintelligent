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
import { Checkbox } from "@si/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@si/ui/components/select";
import { toast } from "@si/ui/components/sonner";
import { cn } from "@si/ui/lib/utils";
import { authClient } from "@/lib/auth-client";
import { generatePassword } from "@/lib/generate-password";
import { publicIdentityHref } from "@/lib/public-url";
import { AVAILABLE_ROLES, DEFAULT_ROLE, type PlatformRole } from "@/components/admin/roles";

type Mode = "invite" | "create";

type DoneState =
  | { kind: "invited"; email: string; existing: boolean }
  | { kind: "created"; email: string; password: string };

function alreadyExists(error: { code?: string; message?: string | null }): boolean {
  return error.code === "USER_ALREADY_EXISTS" || /exist/i.test(error.message ?? "");
}

export function AddUserModal({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<Mode>("invite");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<PlatformRole>(DEFAULT_ROLE);
  const [password, setPassword] = useState("");
  const [markVerified, setMarkVerified] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);

  useEffect(() => {
    if (open) {
      setMode("invite");
      setEmail("");
      setName("");
      setRole(DEFAULT_ROLE);
      setPassword("");
      setMarkVerified(true);
      setError(null);
      setDone(null);
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    // createUser requires a name; default to the email local part so an
    // operator can invite with just an address.
    const effectiveName = name.trim() || trimmedEmail.split("@")[0];

    setSubmitting(true);
    try {
      if (mode === "create") {
        if (password.length < 8) {
          setError("Password must be at least 8 characters.");
          return;
        }
        const created = await authClient.admin.createUser({
          email: trimmedEmail,
          name: effectiveName,
          password,
          role,
          ...(markVerified ? { data: { emailVerified: true } } : {}),
        });
        if (created.error) {
          setError(created.error.message ?? "Failed to create user");
          return;
        }
        toast.success("User created");
        onSuccess();
        setDone({ kind: "created", email: trimmedEmail, password });
        return;
      }

      // Invite: create the account without a credential (password omitted),
      // then send a magic link. Clicking it signs the invitee in and lands
      // them on /welcome to set a passkey or password. If the account
      // already exists this degrades to re-sending a sign-in link.
      const created = await authClient.admin.createUser({
        email: trimmedEmail,
        name: effectiveName,
        role,
      });
      const existing = created.error ? alreadyExists(created.error) : false;
      if (created.error && !existing) {
        setError(created.error.message ?? "Failed to create user");
        return;
      }
      const sent = await authClient.signIn.magicLink({
        email: trimmedEmail,
        callbackURL: publicIdentityHref("/welcome"),
      });
      if (sent.error) {
        setError(
          existing
            ? (sent.error.message ?? "Failed to send the invite email")
            : `Account created, but the invite email failed: ${sent.error.message ?? "unknown error"}. Use "Invite" again to retry.`,
        );
        return;
      }
      onSuccess();
      setDone({ kind: "invited", email: trimmedEmail, existing });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Invite someone by email, or create the account directly.
          </DialogDescription>
        </DialogHeader>

        {!done ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div
              role="radiogroup"
              aria-label="How to add the user"
              className="grid grid-cols-2 gap-2"
            >
              {(
                [
                  { value: "invite", label: "Invite by email" },
                  { value: "create", label: "Create directly" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === opt.value}
                  onClick={() => setMode(opt.value)}
                  className={cn(
                    "rounded-sm border-2 px-3 py-2 text-sm font-medium",
                    mode === opt.value
                      ? "border-border-strong bg-surface-sunken text-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <Field>
              <Label htmlFor="add-user-email">Email</Label>
              <Input
                id="add-user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@example.com"
                required
                autoFocus
              />
              {mode === "invite" && (
                <FieldDescription>
                  They get a sign-in link by email. Opening it creates their session and prompts
                  them to set a passkey or password. The link is short-lived — they can request a
                  fresh one from the sign-in page with this same address.
                </FieldDescription>
              )}
            </Field>

            <Field>
              <Label htmlFor="add-user-name">Name</Label>
              <Input
                id="add-user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Defaults to the email's local part"
              />
            </Field>

            <Field>
              <Label htmlFor="add-user-role">Role</Label>
              <Select value={role} onValueChange={(v) => v && setRole(v as PlatformRole)}>
                <SelectTrigger id="add-user-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {mode === "create" && (
              <>
                <Field>
                  <Label htmlFor="add-user-password">Password</Label>
                  <div className="flex gap-2">
                    <Input
                      id="add-user-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="off"
                      required
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

                <Field>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="add-user-verified"
                      checked={markVerified}
                      onCheckedChange={(v) => setMarkVerified(v === true)}
                    />
                    <Label htmlFor="add-user-verified">Mark email as verified</Label>
                  </div>
                </Field>
              </>
            )}

            {error && <Alert variant="destructive">{error}</Alert>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !email}>
                {submitting
                  ? mode === "invite"
                    ? "Inviting…"
                    : "Creating…"
                  : mode === "invite"
                    ? "Send invite"
                    : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        ) : done.kind === "invited" ? (
          <div className="flex flex-col gap-4">
            <Alert variant="success">
              {done.existing
                ? `That account already exists — sent a sign-in link to ${done.email} instead.`
                : `Invite sent to ${done.email}.`}
            </Alert>
            <p className="text-sm text-muted-foreground">
              The link signs them in and asks them to secure the account with a passkey or password.
            </p>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Alert variant="success">Account created for {done.email}.</Alert>
            <Field>
              <Label>Password</Label>
              <div className="rounded-sm bg-surface-sunken px-3 py-2">
                <code className="type-code block break-all text-primary">{done.password}</code>
              </div>
              <FieldDescription>
                Copy it now — it is not retrievable after this dialog closes.
              </FieldDescription>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(done.password);
                    toast.success("Password copied to clipboard");
                  } catch {
                    toast.error("Could not copy — select and copy manually");
                  }
                }}
              >
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
