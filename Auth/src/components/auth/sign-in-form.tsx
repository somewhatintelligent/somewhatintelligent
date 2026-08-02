import { useEffect, useState } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { type } from "arktype";
import { FingerprintIcon } from "lucide-react";
import { useCapture } from "@/lib/analytics";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { Button } from "@si/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@si/ui/components/card";
import { Alert } from "@si/ui/components/alert";
import { Separator } from "@si/ui/components/separator";
import { GuestlistBrand } from "@/components/guestlist-brand";
import { authClient } from "@/lib/auth-client";
import type { SocialProviders } from "@/lib/providers.functions";
import { SocialSignInButtons } from "./social-sign-in-buttons";

const signInSchema = type({
  email: "string.email",
  password: "string >= 1",
});

const emailOnlySchema = type({ email: "string.email" });

// User-cancel and timeout errors from the WebAuthn modal — we silently no-op
// instead of surfacing an inline error, since the user explicitly dismissed.
const PASSKEY_CANCEL_PATTERN = /cancel|abort|not allowed|timed out|the operation/i;

export function SignInForm({
  clientName,
  redirectTarget,
  providers,
}: {
  clientName?: string;
  redirectTarget: string;
  providers: SocialProviders;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const capture = useCapture();
  const [loading, setLoading] = useState(false);
  const [magicLinkSubmitting, setMagicLinkSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [webauthnSupported, setWebauthnSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"form" | "sent">("form");
  const [sentEmail, setSentEmail] = useState<string>("");

  const anySocial =
    providers.google || providers.microsoft || providers.facebook || providers.linkedin;
  const showDivider = anySocial || webauthnSupported;

  // Capability detection + conditional UI (autofill) arming. Per the BA
  // passkey docs: only call signIn.passkey({ autoFill: true }) when the
  // browser supports conditional mediation. The promise hangs forever if
  // no passkey is registered for this rpID, which is fine — it resolves
  // when the user picks one from the autofill chip on the email input.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.PublicKeyCredential === "undefined") return;
    setWebauthnSupported(true);

    if (typeof window.PublicKeyCredential.isConditionalMediationAvailable !== "function") return;

    let cancelled = false;
    void (async () => {
      try {
        const available = await window.PublicKeyCredential.isConditionalMediationAvailable();
        if (!available || cancelled) return;
        const result = await authClient.signIn.passkey({ autoFill: true });
        if (cancelled || !result || result.error) return;
        // Invalidate re-runs beforeLoad for every matched route, including
        // /_auth/sign-in's own `if (context.session) throw redirect(...)`
        // (root's beforeLoad refreshes context.session in the same pass).
        // That redirect is the actual navigation — don't also call
        // navigate() here, or the two collide and cancel each other,
        // leaving the UI stuck re-invalidating in a loop.
        await router.invalidate();
      } catch {
        // Conditional UI failures are silent by design.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validators: { onBlur: signInSchema },
    onSubmit: async ({ value }) => {
      setLoading(true);
      setError(null);

      let result: Awaited<ReturnType<typeof authClient.signIn.email>>;
      try {
        result = await authClient.signIn.email({
          email: value.email,
          password: value.password,
        });
      } catch (e) {
        // fetch() throws on network failure / CORS preflight rejection / DNS —
        // BA's client surfaces those as thrown TypeErrors rather than
        // returning a result with `.error`. Surface them inline.
        setError(
          e instanceof Error
            ? `Couldn't reach the auth server: ${e.message}`
            : "Couldn't reach the auth server.",
        );
        setLoading(false);
        return;
      }

      if (result.error) {
        setError(
          result.error.message ?? "Something went wrong. One would imagine you should try again.",
        );
        setLoading(false);
        return;
      }

      // When 2FA is enrolled the server deletes the session cookie and
      // returns { twoFactorRedirect: true }. Must hand the user to the
      // challenge page or they'll bounce on the next guarded route.
      const twoFactorPending =
        (result.data as { twoFactorRedirect?: boolean } | null | undefined)?.twoFactorRedirect ===
        true;
      if (twoFactorPending) {
        void navigate({ to: "/two-factor", search: { returnTo: redirectTarget } });
        return;
      }

      capture("signed_in", { method: "email" });

      // Invalidate re-runs beforeLoad for every matched route. That's the
      // actual navigation: /_auth/sign-in's beforeLoad sees the refreshed
      // context.session and throws redirect({ href: redirectTarget }) on
      // its own. Don't also call navigate() here — the router's internal
      // redirect-navigate and an explicit one to the same target collide
      // and cancel each other, which re-triggers loadSession() in a loop
      // instead of ever committing.
      await router.invalidate();
    },
  });

  async function handlePasskeySignIn() {
    setError(null);
    setPasskeySubmitting(true);
    let result: Awaited<ReturnType<typeof authClient.signIn.passkey>>;
    try {
      result = await authClient.signIn.passkey({ autoFill: false });
    } catch (e) {
      setPasskeySubmitting(false);
      setError(
        e instanceof Error
          ? `Couldn't reach the auth server: ${e.message}`
          : "Couldn't reach the auth server.",
      );
      return;
    }
    setPasskeySubmitting(false);

    if (!result || result.error) {
      const message = result?.error?.message ?? "";
      if (!PASSKEY_CANCEL_PATTERN.test(message)) {
        setError(message || "Couldn't sign in with that passkey. Try again.");
      }
      return;
    }

    capture("signed_in", { method: "passkey" });

    // See the onSubmit handler above: invalidate()'s beforeLoad-driven
    // redirect is the navigation; an explicit navigate() here would race it.
    await router.invalidate();
  }

  async function handleMagicLink() {
    const email = form.getFieldValue("email").trim();
    setError(null);

    const validation = emailOnlySchema({ email });
    if (validation instanceof type.errors) {
      setError(email ? "That doesn't look like an email." : "Enter your email first.");
      return;
    }

    setMagicLinkSubmitting(true);
    // Anchor relative targets to identity's origin so BA's verify-endpoint
    // Location header lands the user back here after redirect. Cross-origin
    // returnTos were already validated by decodeReturnTo at route load.
    const callbackURL = redirectTarget.startsWith("/")
      ? new URL(redirectTarget, window.location.origin).toString()
      : redirectTarget;

    let result: Awaited<ReturnType<typeof authClient.signIn.magicLink>>;
    try {
      result = await authClient.signIn.magicLink({ email, callbackURL });
    } catch (e) {
      setMagicLinkSubmitting(false);
      setError(
        e instanceof Error
          ? `Couldn't reach the auth server: ${e.message}`
          : "Couldn't reach the auth server.",
      );
      return;
    }
    setMagicLinkSubmitting(false);

    if (result.error) {
      setError(result.error.message ?? "Couldn't send the link. Try again.");
      return;
    }

    capture("magic_link_requested", {});
    setSentEmail(email);
    setMode("sent");
  }

  if (mode === "sent") {
    return (
      <>
        <GuestlistBrand className="mb-section flex flex-col items-center text-center" />

        <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
          <CardHeader>
            <CardTitle>Check your email.</CardTitle>
            <CardDescription>
              I sent a sign-in link to <strong className="text-foreground">{sentEmail}</strong>.
              Open it and click the button. Good for 5 minutes, single use.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              variant="ghost"
              className="w-full justify-center"
              onClick={() => {
                setMode("form");
                setError(null);
              }}
            >
              Use a password instead
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  const anySubmitting = loading || magicLinkSubmitting || passkeySubmitting;

  return (
    <>
      <GuestlistBrand className="mb-section flex flex-col items-center text-center" />
      {clientName ? (
        <div className="mb-section -mt-4 text-center type-editorial-lede text-muted-foreground">
          continue to <strong className="text-foreground">{clientName}</strong>
        </div>
      ) : (
        <div className="mb-section -mt-4 text-center type-editorial-lede text-muted-foreground">
          sign in to continue
        </div>
      )}

      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        <CardContent className="space-y-0 p-0">
          {(anySocial || webauthnSupported) && (
            <div className="mb-8 flex flex-col gap-3">
              {anySocial && (
                <SocialSignInButtons
                  providers={providers}
                  callbackURL={redirectTarget}
                  disabled={anySubmitting}
                  onStart={() => {
                    setLoading(true);
                    setError(null);
                  }}
                  onError={(message) => {
                    setError(message);
                    setLoading(false);
                  }}
                />
              )}
              {webauthnSupported && (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="w-full justify-center gap-2"
                  onClick={() => {
                    void handlePasskeySignIn();
                  }}
                  disabled={anySubmitting}
                >
                  <FingerprintIcon className="size-4" />
                  {passkeySubmitting ? "Waiting for passkey…" : "Sign in with a passkey"}
                </Button>
              )}
            </div>
          )}

          {showDivider && (
            <div className="mb-8 flex items-center gap-4">
              <Separator className="flex-1" />
              <span className="type-mono-label text-muted-foreground/80">or</span>
              <Separator className="flex-1" />
            </div>
          )}

          <form
            method="post"
            action="/api/auth/sign-in/email"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.AppField name="email">
              {(field) => (
                <field.EmailField
                  label="Email"
                  placeholder="you@example.com"
                  autoComplete="username webauthn"
                />
              )}
            </form.AppField>

            <form.AppField name="password">
              {(field) => <field.PasswordField label="Password" autoComplete="current-password" />}
            </form.AppField>

            <div className="text-right">
              <Link
                to="/reset-password"
                className="text-xs text-muted-foreground/80 hover:text-muted-foreground"
              >
                Forgot Password
              </Link>
            </div>

            {error && <Alert variant="destructive">{error}</Alert>}

            <form.AppForm>
              <form.SubmitButton
                label={loading ? "Signing in…" : "Sign In"}
                className="w-full justify-center py-3.5"
              />
            </form.AppForm>

            <Button
              type="button"
              variant="ghost"
              className="w-full justify-center"
              onClick={() => {
                void handleMagicLink();
              }}
              disabled={anySubmitting}
            >
              {magicLinkSubmitting ? "Sending…" : "Send me a link instead"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            No account?{" "}
            <Link
              to="/sign-up"
              search={{ returnTo: redirectTarget }}
              className="font-semibold text-primary"
            >
              I suppose you could make one
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
