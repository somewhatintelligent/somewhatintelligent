import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const Route = createFileRoute("/_auth/reset-password")({
  validateSearch: (search: Record<string, unknown>): { token?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  head: () => ({ meta: [{ title: "Reset Password — Identity" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  return <ResetPasswordForm token={token} />;
}
