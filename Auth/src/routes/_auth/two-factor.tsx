import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Alert } from "@si/ui/components/alert";
import { Button } from "@si/ui/components/button";
import { Card, CardContent } from "@si/ui/components/card";
import { Checkbox } from "@si/ui/components/checkbox";
import { Field, FieldLabel } from "@si/ui/components/field";
import { Input } from "@si/ui/components/input";
import { GuestlistBrand } from "@/components/guestlist-brand";
import { authClient } from "@/lib/auth-client";
import { toBrowserHref } from "@/lib/basepath";
import { decodeReturnTo } from "@/lib/return-to";

type Method = "totp" | "backup";

interface TwoFactorSearch {
  returnTo?: string;
  method?: Method;
}

export const Route = createFileRoute("/_auth/two-factor")({
  validateSearch: (search: Record<string, unknown>): TwoFactorSearch => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
    method: search.method === "backup" ? "backup" : "totp",
  }),
  head: () => ({ meta: [{ title: "Two-Factor Verification — Identity" }] }),
  component: TwoFactorPage,
});

function TwoFactorPage() {
  const { returnTo, method } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBackup = method === "backup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code) return;
    setLoading(true);
    setError(null);
    const trimmed = code.trim();
    const result = isBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: trimmed, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: trimmed, trustDevice });
    if (result.error) {
      setError(result.error.message ?? "That code didn't work. One is meant to type carefully.");
      setLoading(false);
      return;
    }
    const target = decodeReturnTo(returnTo) ?? "/account";
    await router.invalidate();
    // toBrowserHref: a raw internal path handed to navigate({ href }) is
    // read in the browser frame (mount input-stripped), so the default
    // `/account` would collapse to the mount root — see sign-in.tsx
    // beforeLoad. Absolute returnTo URLs pass through untouched (navigate
    // turns a full URL into a document navigation on its own).
    await navigate({
      href: toBrowserHref(target),
      reloadDocument: target.startsWith("/api/"),
    });
  }

  return (
    <>
      <GuestlistBrand className="mb-section flex flex-col items-center text-center" />
      <div className="mb-section -mt-4 text-center type-editorial-lede text-muted-foreground">
        {isBackup
          ? "enter one of your backup codes"
          : "enter the 6-digit code from your authenticator"}
      </div>

      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        <CardContent className="space-y-0 p-0">
          <form method="post" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field>
              <FieldLabel>{isBackup ? "Backup code" : "Authenticator code"}</FieldLabel>
              <Input
                inputMode={isBackup ? "text" : "numeric"}
                autoComplete="one-time-code"
                autoFocus
                placeholder={isBackup ? "xxxx-xxxx" : "123456"}
                maxLength={isBackup ? 32 : 6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={loading}
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={trustDevice}
                onCheckedChange={(v) => setTrustDevice(v === true)}
                disabled={loading}
              />
              Trust this device for 30 days
            </label>

            {error && <Alert variant="destructive">{error}</Alert>}

            <Button
              type="submit"
              className="w-full justify-center py-3.5"
              disabled={loading || !code.trim()}
            >
              {loading ? "Verifying…" : "Verify"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            {isBackup ? (
              <Link
                to="/two-factor"
                search={{ returnTo, method: "totp" }}
                replace
                className="font-semibold text-primary"
              >
                Use your authenticator instead
              </Link>
            ) : (
              <Link
                to="/two-factor"
                search={{ returnTo, method: "backup" }}
                replace
                className="font-semibold text-primary"
              >
                Use a backup code instead
              </Link>
            )}
          </p>

          <p className="mt-3 text-center text-sm text-muted-foreground/80">
            <Link to="/sign-in" className="hover:text-muted-foreground">
              Sign in with a different account
            </Link>
          </p>
        </CardContent>
      </Card>

      <div className="mt-section flex justify-center gap-grid text-xs text-muted-foreground/80">
        <Link to="/privacy" className="hover:text-muted-foreground">
          Privacy
        </Link>
        <Link to="/terms" className="hover:text-muted-foreground">
          Terms
        </Link>
      </div>
    </>
  );
}
