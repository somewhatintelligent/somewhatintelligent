import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { type } from "arktype";
import { useCapture } from "@/lib/analytics";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { Card, CardContent } from "@si/ui/components/card";
import { Alert } from "@si/ui/components/alert";
import { GuestlistBrand } from "@/components/guestlist-brand";
import { authClient } from "@/lib/auth-client";
import type { SocialProviders } from "@/lib/providers.functions";
import { SocialSignInButtons } from "./social-sign-in-buttons";

const signUpSchema = type({
  name: "string >= 2",
  email: "string.email",
  password: "string >= 8",
  confirmPassword: "string >= 8",
});

export function SignUpForm({
  returnTo,
  providers,
}: {
  returnTo?: string;
  providers: SocialProviders;
}) {
  const navigate = useNavigate();
  const capture = useCapture();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
    validators: { onBlur: signUpSchema },
    onSubmit: async ({ value }) => {
      setError(null);

      if (value.password !== value.confirmPassword) {
        setError("The passwords do not match.");
        return;
      }

      setLoading(true);

      const result = await authClient.signUp.email({
        name: value.name,
        email: value.email,
        password: value.password,
        ...(returnTo && { callbackURL: returnTo }),
      });

      if (result.error) {
        setError(result.error.message ?? "Something went wrong.");
        setLoading(false);
      } else {
        capture("signed_up", { method: "email" });
        void navigate({
          to: "/verify-email",
          search: {
            email: value.email,
            name: value.name,
            ...(returnTo && { returnTo }),
          },
        });
      }
    },
  });

  return (
    <>
      <GuestlistBrand className="mb-section flex flex-col items-center text-center" />
      <div className="mb-section -mt-4 text-center type-editorial-lede text-muted-foreground">
        create an account
      </div>

      <Card className="p-page" style={{ viewTransitionName: "auth-card" }}>
        <CardContent className="space-y-0 p-0">
          <SocialSignInButtons
            providers={providers}
            callbackURL={returnTo ?? "/account"}
            disabled={loading}
            onStart={() => {
              setLoading(true);
              setError(null);
            }}
            onError={(message) => {
              setError(message);
              setLoading(false);
            }}
          />
          <form
            method="post"
            action="/api/auth/sign-up/email"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.AppField name="name">
              {(field) => <field.TextField label="Name" placeholder={"What you go by\u2026"} />}
            </form.AppField>

            <form.AppField name="email">
              {(field) => <field.EmailField label="Email" placeholder="you@example.com" />}
            </form.AppField>

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
              <form.SubmitButton label="Create Account" className="w-full justify-center py-3.5" />
            </form.AppForm>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/sign-in" className="font-semibold text-primary">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </>
  );
}
