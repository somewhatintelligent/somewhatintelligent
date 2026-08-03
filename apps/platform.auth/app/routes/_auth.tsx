import { createFileRoute, Outlet } from "@tanstack/react-router";
import { loadProviders } from "@/lib/providers.functions";
import { describeAppVersion, formatAppVersion } from "@/lib/version";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async () => ({ providers: await loadProviders() }),
  component: AuthLayout,
});

function AuthLayout() {
  const { version } = Route.useRouteContext();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-page">
      <div className="w-full max-w-[560px]">
        <Outlet />
      </div>
      {/* Build fingerprint, rendered subtly (exec plan 0001: version strings
          in every app's UI). The deployed Worker version, not a build-time
          constant — see @/lib/version. */}
      <footer
        className="mt-6 text-center font-mono text-[10px] text-muted-foreground/60"
        title={describeAppVersion(version)}
      >
        identity {formatAppVersion(version)}
      </footer>
    </main>
  );
}
