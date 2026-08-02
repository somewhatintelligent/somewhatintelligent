import { useEffect } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignInForm } from "@/components/auth/sign-in-form";
import { toBrowserHref } from "@/lib/basepath";
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
      // An absolute returnTo (e.g. a peer app's `<apex>/app/...`) must not
      // become an SSR Location header: under the `/account` vmf mount bouncer
      // prepends the mount to every same-origin Location, corrupting
      // cross-mount targets. SignInPage finishes that bounce in the browser.
      if (typeof document === "undefined") return;
      throw redirect({ href: target });
    }
    // Root-relative targets. On the server the raw path is already right:
    // bouncer prepends the mount to the Location header, which is correct
    // for identity's own routes and the `/api/$` guestlist proxy alike. On
    // the client, `redirect({ href })` reads the href in the BROWSER frame —
    // the mount rewrite input-strips a leading `/account` before matching —
    // so hand it the mount-prefixed public form (toBrowserHref). Without
    // that, the default target `/account` is byte-identical to the mount,
    // collapses to `/`, and ping-pongs against the index route's redirect
    // forever (the "sign-in hangs calling loadSession" loop).
    throw redirect({
      href: toBrowserHref(target),
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
