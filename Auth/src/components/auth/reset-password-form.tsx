import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { type } from "arktype";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { Button } from "@si/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@si/ui/components/card";
import { Alert } from "@si/ui/components/alert";
import { GuestlistBrand } from "@/components/guestlist-brand";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token?: string }) {
  return token ? <SetNewPassword token={token} /> : <RequestReset />;
}

const requestSchema = type({ email: "string.email" });

function RequestReset() {
  const [_loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { email: "" },
    validators: { onBlur: requestSchema },
    onSubmit: async ({ value }) => {
      setLoading(true);
      setError(null);

      const result = await authClient.requestPasswordReset({
        email: value.email,
        redirectTo: "/reset-password",
      });

      if (result.error) {
        setError(result.error.message ?? "Something went wrong.");
      } else {
        setSent(true);
      }
      setLoading(false);
    },
  });

  return (
    <>
      <GuestlistBrand className="mb-section flex flex-col items-center text-center" />
      <div className="mb-section -mt-4 text-center type-editorial-lede text-muted-foreground">
        reset password
      </div>

      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        {sent ? (
          <>
            <CardHeader>
              <CardTitle>Check your email.</CardTitle>
              <CardDescription>
                If an account exists with that address, we have sent a reset link. We are not going
                to confirm or deny which it is — thus, a small measure of privacy is preserved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/sign-in" className="block">
                <Button variant="secondary" className="w-full justify-center py-3.5">
                  Back to sign in
                </Button>
              </Link>
            </CardContent>
          </>
        ) : (
          <CardContent className="space-y-0 p-0">
            <form
              method="post"
              action="/api/auth/forget-password"
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void form.handleSubmit();
              }}
            >
              <form.AppField name="email">
                {(field) => <field.EmailField label="Email" placeholder="you@example.com" />}
              </form.AppField>

              {error && <Alert variant="destructive">{error}</Alert>}

              <form.AppForm>
                <form.SubmitButton
                  label="Send Reset Link"
                  className="w-full justify-center py-3.5"
                />
              </form.AppForm>
            </form>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              <Link to="/sign-in" className="font-semibold text-primary">
                Back to sign in
              </Link>
            </p>
          </CardContent>
        )}
      </Card>
    </>
  );
}

const newPasswordSchema = type({
  password: "string >= 8",
  confirmPassword: "string >= 8",
});

function SetNewPassword({ token }: { token: string }) {
  const [_loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useAppForm({
    defaultValues: { password: "", confirmPassword: "" },
    validators: { onBlur: newPasswordSchema },
    onSubmit: async ({ value }) => {
      setError(null);

      if (value.password !== value.confirmPassword) {
        setError("The passwords do not match. This should be self-evident.");
        return;
      }

      setLoading(true);

      const result = await authClient.resetPassword({
        newPassword: value.password,
        token,
      });

      if (result.error) {
        setError(
          result.error.message ?? "The token may have expired. These things have a shelf life.",
        );
        setLoading(false);
      } else {
        setSuccess(true);
        setLoading(false);
      }
    },
  });

  return (
    <>
      <GuestlistBrand className="mb-section flex flex-col items-center text-center" />
      <div className="mb-section -mt-4 text-center type-editorial-lede text-muted-foreground">
        new password
      </div>

      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        {success ? (
          <>
            <CardHeader>
              <CardTitle>Password updated.</CardTitle>
              <CardDescription>
                Your new password is active. Try to remember this one, I suppose.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/sign-in" className="block">
                <Button className="w-full justify-center py-3.5">Sign in</Button>
              </Link>
            </CardContent>
          </>
        ) : (
          <CardContent className="space-y-0 p-0">
            <p className="mb-4 text-xs text-muted-foreground/80">
              Choose something you will not immediately forget. Or do — the reset process is, as you
              have now seen, not especially arduous.
            </p>

            <form
              method="post"
              action="/api/auth/reset-password"
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void form.handleSubmit();
              }}
            >
              <form.AppField name="password">
                {(field) => <field.PasswordField label="Password" autoComplete="new-password" />}
              </form.AppField>

              <form.AppField name="confirmPassword">
                {(field) => (
                  <field.PasswordField label="Confirm password" autoComplete="new-password" />
                )}
              </form.AppField>

              {error && <Alert variant="destructive">{error}</Alert>}

              <form.AppForm>
                <form.SubmitButton label="Set Password" className="w-full justify-center py-3.5" />
              </form.AppForm>
            </form>
          </CardContent>
        )}
      </Card>
    </>
  );
}
