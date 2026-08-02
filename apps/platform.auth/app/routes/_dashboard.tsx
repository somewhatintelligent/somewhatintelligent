import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "platform.ui/components/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { DashboardBreadcrumb } from "@/components/dashboard/dashboard-breadcrumb";
import { OrgSwitcher } from "@/components/header/org-switcher";
import { authClient } from "@/lib/auth-client";
import { isAdminRole } from "@/lib/session";

export const Route = createFileRoute("/_dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { session: ssrSession } = Route.useRouteContext();
  const { data: liveSession, isPending } = authClient.useSession();
  const navigate = useNavigate();

  const session = liveSession ?? ssrSession;

  // Only bounce to sign-in when there is genuinely no session — live AND SSR
  // both absent (after the live query settles). Redirecting on `!liveSession`
  // alone caused an infinite loop: a transient client get-session failure left
  // the valid SSR session in place, so /sign-in (which gates on the SSR
  // session) bounced straight back here, and round and round.
  useEffect(() => {
    if (!isPending && !liveSession && !ssrSession) {
      void navigate({ to: "/sign-in", replace: true });
    }
  }, [isPending, liveSession, ssrSession, navigate]);

  if (!session) return null;

  return (
    <SidebarProvider>
      <AppSidebar session={session} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-1.5 border-b-2 border-border px-4">
          <SidebarTrigger />
          <DashboardBreadcrumb />
          <div className="ml-auto flex items-center gap-2">
            <OrgSwitcher isAdmin={isAdminRole(session.user.role)} />
          </div>
        </header>
        <div className="flex min-h-[calc(100svh-3rem)] flex-col p-page">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
