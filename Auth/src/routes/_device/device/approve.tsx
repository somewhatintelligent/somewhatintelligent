import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent } from "@si/ui/components/card";
import { Badge } from "@si/ui/components/badge";
import { Button } from "@si/ui/components/button";
import { Alert } from "@si/ui/components/alert";
import { authClient } from "@/lib/auth-client";

interface DeviceApproveSearch {
  user_code: string | undefined;
}

export const Route = createFileRoute("/_device/device/approve")({
  validateSearch: (s: Record<string, unknown>): DeviceApproveSearch => ({
    user_code: typeof s.user_code === "string" ? s.user_code : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    // `to`-based (not href) so the redirect stays mount-correct on the
    // client — see routes/index.tsx.
    if (!context.session) throw redirect({ to: "/sign-in" });
    if (!search.user_code) throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "Approve Device — Identity" }] }),
  component: DeviceApprovePage,
});

function DeviceApprovePage() {
  const { user_code } = Route.useSearch();
  const { session } = Route.useRouteContext();
  const userCode = user_code!;
  const user = session!.user;

  return (
    <>
      <div className="mb-section text-center">
        <div className="type-display-title">Authorize</div>
        <div className="type-editorial-lede mt-grid text-muted-foreground">
          Something is asking to be you. Whether you should let it is, I suppose, your decision.
        </div>
      </div>

      <Card className="p-page">
        <CardContent className="space-y-0 p-0">
          <div className="mb-8 flex items-center gap-3 rounded-sm bg-surface-sunken px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-sm bg-primary text-xs font-semibold text-primary-foreground">
              {user.name?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div>
              <div className="text-sm font-medium">{user.name}</div>
              <div className="font-mono text-xs text-muted-foreground/80">{user.email}</div>
            </div>
          </div>

          <div className="mb-8">
            <div className="type-mono-label mb-3 text-muted-foreground/80">Device Code</div>
            <Badge variant="secondary" className="font-mono text-sm tracking-widest">
              {userCode.slice(0, 4)}-{userCode.slice(4)}
            </Badge>
          </div>

          <DeviceApproveActions userCode={userCode} />

          <p className="mt-5 text-center text-xs text-muted-foreground/80">
            You can revoke this at any time. We will not ask if you are sure.
          </p>
        </CardContent>
      </Card>
    </>
  );
}

function DeviceApproveActions({ userCode }: { userCode: string }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setLoading(true);
    setError(null);
    try {
      await authClient.device.approve({ userCode });
      void navigate({ to: "/account" });
    } catch {
      setError("Failed to approve device. Try again, or don't.");
      setLoading(false);
    }
  }

  async function handleDeny() {
    setLoading(true);
    setError(null);
    try {
      await authClient.device.deny({ userCode });
      void navigate({ to: "/account" });
    } catch {
      setError("Failed to deny device. Ironic.");
      setLoading(false);
    }
  }

  return (
    <>
      {error && (
        <Alert variant="destructive" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Button className="justify-center" onClick={handleApprove} disabled={loading}>
          Approve
        </Button>
        <Button variant="ghost" className="justify-center" onClick={handleDeny} disabled={loading}>
          Deny
        </Button>
      </div>
    </>
  );
}
