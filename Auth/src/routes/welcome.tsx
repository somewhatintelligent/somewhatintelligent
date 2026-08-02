import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@si/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@si/ui/components/card";
import { Alert } from "@si/ui/components/alert";
import { GuestlistBrand } from "@/components/guestlist-brand";
import { authClient } from "@/lib/auth-client";
import { publicIdentityHref } from "@/lib/public-url";

/**
 * Post-invite landing page. Operator-issued app invitations send a magic
 * link whose `callbackURL` points here (see
 * `components/admin/add-user-modal.tsx`), so a freshly created account's
 * first signed-in view nudges them to secure the account: register a
 * passkey right now, or email themselves a set-password link (invited
 * accounts have no credential yet — better-auth's reset flow creates one
 * on first use). Both are skippable; magic links keep working regardless.
 */
export const Route = createFileRoute("/welcome")({
  head: () => ({ meta: [{ title: "Welcome" }] }),
  component: WelcomePage,
});

type Step = "choose" | "passkey-added" | "reset-sent";

function WelcomePage() {
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState<"passkey" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) void navigate({ to: "/sign-in", replace: true });
  }, [session, navigate]);

  if (!session) return null;
  const email = session.user.email;

  async function handleAddPasskey() {
    setError(null);
    setBusy("passkey");
    try {
      const result = await authClient.passkey.addPasskey();
      if (result?.error) {
        setError(result.error.message ?? "Passkey registration was cancelled or failed.");
        return;
      }
      setStep("passkey-added");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey registration failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePasswordLink() {
    setError(null);
    setBusy("password");
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: publicIdentityHref("/reset-password"),
      });
      if (result.error) {
        setError(result.error.message ?? "Couldn't send the password link.");
        return;
      }
      setStep("reset-sent");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-page">
      <div className="w-full max-w-[560px]">
        <GuestlistBrand className="mb-section flex flex-col items-center text-center" />

        <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
          {step === "choose" && (
            <>
              <CardHeader>
                <CardTitle>Welcome, {session.user.name || email}.</CardTitle>
                <CardDescription>
                  You&apos;re signed in. Add a way to sign in next time — a passkey is the fastest,
                  or set a password if you prefer.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button
                  className="w-full justify-center py-3.5"
                  onClick={handleAddPasskey}
                  disabled={busy !== null}
                >
                  {busy === "passkey" ? "Waiting for your device…" : "Add a passkey"}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full justify-center py-3.5"
                  onClick={handlePasswordLink}
                  disabled={busy !== null}
                >
                  {busy === "password" ? "Sending…" : "Email me a password setup link"}
                </Button>

                {error && <Alert variant="destructive">{error}</Alert>}

                <p className="mt-2 text-center text-sm text-muted-foreground">
                  <Link to="/" className="font-semibold text-primary">
                    Skip for now
                  </Link>{" "}
                  — you can always sign in with an email link.
                </p>
              </CardContent>
            </>
          )}

          {step === "passkey-added" && (
            <>
              <CardHeader>
                <CardTitle>Passkey added.</CardTitle>
                <CardDescription>
                  Next time, sign in with your fingerprint, face, or device PIN. No password
                  required.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link to="/" className="block">
                  <Button className="w-full justify-center py-3.5">Continue</Button>
                </Link>
              </CardContent>
            </>
          )}

          {step === "reset-sent" && (
            <>
              <CardHeader>
                <CardTitle>Check your email.</CardTitle>
                <CardDescription>
                  We sent a link to <strong className="text-foreground">{email}</strong> that lets
                  you choose a password.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link to="/" className="block">
                  <Button variant="secondary" className="w-full justify-center py-3.5">
                    Continue to dashboard
                  </Button>
                </Link>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
