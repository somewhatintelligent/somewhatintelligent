import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Badge } from "@si/ui/components/badge";
import { Button, buttonVariants } from "@si/ui/components/button";
import { cn } from "@si/ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@si/ui/components/dialog";
import { Input } from "@si/ui/components/input";
import { Field, FieldLabel } from "@si/ui/components/field";
import { Alert } from "@si/ui/components/alert";
import { authClient } from "@/lib/auth-client";

export function TwoFactorDialog({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [password, setPassword] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleEnable() {
    setError(null);
    const result = await authClient.twoFactor.enable({ password });
    if (result.error) {
      setError(result.error.message ?? "Failed to enable 2FA.");
      return;
    }
    if (result.data) {
      setTotpUri(result.data.totpURI ?? null);
      setBackupCodes(result.data.backupCodes ?? null);
    }
    setPassword("");
    void router.invalidate();
  }

  async function handleDisable() {
    setError(null);
    const result = await authClient.twoFactor.disable({ password });
    if (result.error) {
      setError(result.error.message ?? "Failed to disable 2FA.");
      return;
    }
    setTotpUri(null);
    setBackupCodes(null);
    setPassword("");
    void router.invalidate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setPassword("");
          setError(null);
        }
      }}
    >
      <DialogTrigger className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
        {enabled ? "Manage" : "Enable"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Two-Factor Authentication</DialogTitle>
          <DialogDescription>
            Whether it makes you safer or merely more inconvenienced is, I suppose, a matter of
            perspective.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Status:</span>
            {enabled ? (
              <Badge variant="success">Enabled</Badge>
            ) : (
              <Badge variant="secondary">Disabled</Badge>
            )}
          </div>

          {totpUri && (
            <div className="rounded-sm bg-surface-sunken px-4 py-3">
              <div className="type-mono-label mb-2 text-muted-foreground/80">TOTP URI</div>
              <code className="type-code break-all text-primary">{totpUri}</code>
              <p className="mt-2 text-xs text-muted-foreground/80">
                Scan this with your authenticator app. Or copy it — the result is the same.
              </p>
            </div>
          )}

          {backupCodes && (
            <div className="rounded-sm bg-surface-sunken px-4 py-3">
              <div className="type-mono-label mb-2 text-muted-foreground/80">Backup Codes</div>
              <div className="grid grid-cols-2 gap-1">
                {backupCodes.map((code) => (
                  <code key={code} className="type-code text-foreground">
                    {code}
                  </code>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground/80">
                Store these somewhere safe. They will not be shown again, and so on.
              </p>
            </div>
          )}

          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel>Password</FieldLabel>
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Confirm your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button
              variant={enabled ? "destructive" : "secondary"}
              className="w-full justify-center"
              onClick={enabled ? handleDisable : handleEnable}
              disabled={!password}
            >
              {enabled ? "Disable 2FA" : "Enable 2FA"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
