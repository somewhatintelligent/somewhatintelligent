import { createFileRoute } from "@tanstack/react-router";
import { VerifyEmailHandler } from "@/components/auth/verify-email-handler";
import { AwaitingVerification } from "@/components/auth/awaiting-verification";
import { decodeReturnTo } from "@/lib/return-to";

interface VerifyEmailSearch {
  token?: string;
  email?: string;
  name?: string;
  returnTo?: string;
}

export const Route = createFileRoute("/_auth/verify-email")({
  validateSearch: (search: Record<string, unknown>): VerifyEmailSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
    email: typeof search.email === "string" ? search.email : undefined,
    name: typeof search.name === "string" ? search.name : undefined,
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  head: () => ({ meta: [{ title: "Verify Email — Identity" }] }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token, email, name, returnTo } = Route.useSearch();
  const decoded = decodeReturnTo(returnTo);
  if (token) return <VerifyEmailHandler token={token} returnTo={decoded} />;
  return <AwaitingVerification email={email} name={name} returnTo={decoded} />;
}
