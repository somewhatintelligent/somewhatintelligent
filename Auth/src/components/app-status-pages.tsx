// Root-level errorComponent + notFoundComponent used by the root route.
import { Link } from "@tanstack/react-router";

import { Button } from "@si/ui/components/button";
import { StatusPage } from "@/components/status-page";

function trimMessage(raw: string, max = 200): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s\S*$/, "") + "…";
}

export function AppNotFound() {
  return (
    <StatusPage
      kind="not-found"
      title={
        <>
          Nothing <span className="text-primary italic">here</span>.
        </>
      }
      description="That page doesn't exist, or it was revoked, or you followed a stale link. The platform can't distinguish."
      actions={
        <>
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href="javascript:history.back()" />}
          >
            ← Back
          </Button>
          <Button nativeButton={false} render={<Link to="/" />}>
            Go home
          </Button>
        </>
      }
    />
  );
}

export function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const message = trimMessage(error.message || "An unexpected error occurred.");
  // ENVIRONMENT is injected at build time from wrangler.jsonc vars.
  // Hide stack traces in staging + production.
  const detail = import.meta.env.ENVIRONMENT === "development" ? error.stack : null;
  return (
    <StatusPage
      kind="error"
      title={
        <>
          Something <span className="text-destructive italic">broke</span>.
        </>
      }
      description={message}
      detail={detail}
      actions={
        <>
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
          <Button nativeButton={false} render={<Link to="/" />}>
            Go home
          </Button>
        </>
      }
    />
  );
}
