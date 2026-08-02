import { useEffect } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { decodeReturnTo } from "@/lib/return-to";

export const Route = createFileRoute("/_auth/sign-up")({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    if (!context.session) return;
    const target = decodeReturnTo(search.returnTo) ?? "/account";
    if (/^https?:\/\//.test(target)) {
      // Absolute returnTo targets bounce in the browser, never as an SSR
      // Location — bounced in the browser instead (see sign-in.tsx).
      if (typeof document === "undefined") return;
      throw redirect({ href: target });
    }
    throw redirect({
      href: target,
      reloadDocument: target.startsWith("/api/"),
    });
  },
  head: () => ({ meta: [{ title: "Sign Up — Identity" }] }),
  component: SignUpPage,
});

function SignUpPage() {
  const { returnTo } = Route.useSearch();
  const { providers, session } = Route.useRouteContext();
  const target = decodeReturnTo(returnTo);
  // Signed-in with an absolute returnTo: finish the deferred bounce here.
  useEffect(() => {
    if (session && target && /^https?:\/\//.test(target)) window.location.replace(target);
  }, [session, target]);
  return <SignUpForm returnTo={target} providers={providers} />;
}
