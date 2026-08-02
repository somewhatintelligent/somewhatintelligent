import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@si/ui/components/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@si/ui/components/card";
import { Alert } from "@si/ui/components/alert";
import { GuestlistBrand } from "@/components/guestlist-brand";
import { authClient } from "@/lib/auth-client";

const RESEND_COOLDOWN = 60;

export function AwaitingVerification({
  email,
  name,
  returnTo,
}: {
  email?: string;
  name?: string;
  returnTo?: string;
}) {
  const navigate = useNavigate();
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  async function handleResend() {
    if (!email || cooldown > 0) return;
    setResending(true);
    setError(null);

    const result = await authClient.sendVerificationEmail({
      email,
      ...(returnTo && { callbackURL: returnTo }),
    });

    if (result.error) {
      setError(result.error.message ?? "Failed to resend.");
    } else {
      setResent(true);
      setCooldown(RESEND_COOLDOWN);
      const interval = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            clearInterval(interval);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }
    setResending(false);
  }

  async function handleSignOut() {
    await authClient.signOut();
    void navigate({ to: "/sign-in" });
  }

  return (
    <>
      <GuestlistBrand className="mb-section flex flex-col items-center text-center" />

      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        <CardHeader>
          <CardTitle>{name ? `${name}, check your email.` : "Check your email."}</CardTitle>
          <CardDescription>
            I sent a verification link to{" "}
            {email ? <strong className="text-foreground">{email}</strong> : "your email address"}.
            Open it and click the button. That's the whole process.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && <Alert variant="destructive">{error}</Alert>}
          {resent && !error && <Alert>Sent. Check your inbox again.</Alert>}
          <Button
            variant="secondary"
            className="w-full justify-center"
            onClick={handleResend}
            disabled={resending || cooldown > 0 || !email}
          >
            {cooldown > 0
              ? `Resend in ${cooldown}s`
              : resending
                ? "Sending\u2026"
                : "Resend verification email"}
          </Button>
          <Button variant="ghost" className="w-full justify-center" onClick={handleSignOut}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
