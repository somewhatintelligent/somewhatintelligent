import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { isAdminRole } from "@/lib/session";

export const Route = createFileRoute("/_dashboard/admin")({
  // Full-load / SSR gate. On the client `context.session` is the root
  // `beforeLoad` result, which does NOT re-run on SPA navigation — so it can
  // be a stale or not-yet-hydrated value. Only hard-bounce when we have a
  // *definitive* session that isn't an admin; the unknown case is resolved in
  // the component against the live client session. (Same shape as
  // `_dashboard`'s sign-in guard, which exists to avoid this exact transient-
  // session bounce.)
  beforeLoad: ({ context }) => {
    if (context.session && !isAdminRole(context.session.user.role)) {
      // `to`-based (not href): under the /account vmf mount an href of
      // "/account" is read in the browser frame and input-stripped to "/" —
      // see routes/index.tsx.
      throw redirect({ to: "/account" });
    }
  },
  component: AdminGate,
});

function AdminGate() {
  const { session: ssrSession } = Route.useRouteContext();
  const { data: liveSession, isPending } = authClient.useSession();
  const navigate = useNavigate();

  const session = liveSession ?? ssrSession;
  const isAdmin = isAdminRole(session?.user.role);

  // Bounce non-admins only once the live session has settled. Never redirect
  // while the session is still unknown (live query pending and no SSR session)
  // — that's the hydration window that was sending admins to /account.
  useEffect(() => {
    if (!isPending && session && !isAdmin) {
      void navigate({ to: "/account", replace: true });
    }
  }, [isPending, session, isAdmin, navigate]);

  // Render the admin section only once we positively know the viewer is an
  // admin — avoids both the false bounce and flashing admin UI to non-admins.
  if (!isAdmin) return null;
  return <Outlet />;
}
