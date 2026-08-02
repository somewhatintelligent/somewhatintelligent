import { useEffect } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignInForm } from "@/components/auth/sign-in-form";
import { decodeReturnTo } from "@/lib/return-to";

const OAUTH_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "exp",
  "sig",
] as const;

function buildAuthorizeUrl(params: Record<string, string | undefined>): string | undefined {
  if (!params.client_id) return undefined;
  const qs = new URLSearchParams();
  for (const key of OAUTH_PARAMS) {
    const v = params[key];
    if (v) qs.set(key, v);
  }
  return `/api/auth/oauth2/authorize?${qs.toString()}`;
}

function resolveTarget(search: Record<string, string | undefined>): string {
  const authorizeUrl = buildAuthorizeUrl(search);
  if (authorizeUrl) return authorizeUrl;
  const validated = decodeReturnTo(search.returnTo);
  return validated ?? "/account";
}

export const Route = createFileRoute("/_auth/sign-in")({
  validateSearch: (search: Record<string, unknown>): Record<string, string | undefined> =>
    Object.fromEntries(
      Object.entries(search).filter(([, v]) => typeof v === "string" || v === undefined),
    ) as Record<string, string | undefined>,
  beforeLoad: ({ context, search }) => {
    if (!context.session) return;
    const target = resolveTarget(search);
    if (/^https?:\/\//.test(target)) {
      // An absolute returnTo (a peer app's `<apex>/app/...`) is bounced in the
      // browser by SignInPage rather than becoming an SSR Location header.
      if (typeof document === "undefined") return;
      throw redirect({ href: target });
    }
    throw redirect({
      href: target,
      // The OAuth authorize URL lives on the `/api/$` server route — nothing
      // for the client router to render, so force a document navigation.
      reloadDocument: target.startsWith("/api/"),
    });
  },
  loaderDeps: ({ search }) => ({
    client_id: search.client_id,
    redirect_uri: search.redirect_uri,
    returnTo: search.returnTo,
  }),
  loader: ({ deps }) => ({ target: resolveTarget(deps) }),
  head: () => ({ meta: [{ title: "Sign In — Identity" }] }),
  component: SignInPage,
});

function SignInPage() {
  const { target } = Route.useLoaderData();
  const { providers, session } = Route.useRouteContext();
  // Signed-in with an absolute returnTo: beforeLoad deferred the bounce to
  // the browser (see its comment) — finish it here, outside vmf's reach.
  useEffect(() => {
    if (session && /^https?:\/\//.test(target)) window.location.replace(target);
  }, [session, target]);
  return <SignInForm redirectTarget={target} providers={providers} />;
}
