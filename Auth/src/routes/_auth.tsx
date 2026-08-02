import { createFileRoute, Outlet } from "@tanstack/react-router";
import { loadProviders } from "@/lib/providers.functions";
import { APP_COMMIT, APP_VERSION } from "@/lib/version";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async () => ({ providers: await loadProviders() }),
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-page">
      <div className="w-full max-w-[560px]">
        <Outlet />
      </div>
      {/* Build fingerprint, rendered subtly (exec plan 0001: version strings
          in every app's UI). Values are vite-define build-time constants. */}
      <footer className="mt-6 text-center font-mono text-[10px] text-muted-foreground/60">
        identity v{APP_VERSION} · {APP_COMMIT}
      </footer>
    </main>
  );
}
