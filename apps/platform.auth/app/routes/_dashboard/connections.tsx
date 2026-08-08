import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "platform.ui/components/card";
import { Badge } from "platform.ui/components/badge";
import { buttonVariants } from "platform.ui/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "platform.ui/components/alert-dialog";
import { toast } from "platform.ui/components/sonner";
import { cn } from "platform.ui/lib/utils";
import { authClient } from "@/lib/auth-client";
import { scopeLabel } from "../../../shared/scopes";
import { fetchConnections } from "@/lib/connections.functions";

export const Route = createFileRoute("/_dashboard/connections")({
  loader: async () => fetchConnections(),
  head: () => ({ meta: [{ title: "Connections — Identity" }] }),
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const { connections } = Route.useLoaderData();

  return (
    <div className="flex flex-1 flex-col">
      {connections.length > 0 && (
        <div className="mb-grid flex items-center justify-end">
          <Badge variant="secondary" size="lg">
            {connections.length} app{connections.length !== 1 && "s"}
          </Badge>
        </div>
      )}

      {connections.length === 0 ? (
        <Card className="flex-1">
          <CardHeader>
            <CardTitle>No Connected Apps</CardTitle>
            <CardDescription>
              No applications have been granted access to your account. Your identity remains, for
              the moment, entirely your own.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-grid">
          {connections.map((consent) => (
            <Card key={consent.consentId}>
              <CardHeader>
                <CardTitle>{consent.clientName ?? consent.clientId}</CardTitle>
                <CardDescription>
                  Authorized{" "}
                  {consent.createdAt
                    ? new Date(consent.createdAt).toLocaleDateString()
                    : "at some point"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-1.5">
                    {consent.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary">
                        {scopeLabel(scope)}
                      </Badge>
                    ))}
                  </div>
                  <RevokeButton consentId={consent.consentId} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RevokeButton({ consentId }: { consentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRevoke() {
    setLoading(true);
    const res = await authClient.oauth2.deleteConsent({ id: consentId });
    if (res.error) {
      toast.error(res.error.message ?? "Failed to revoke access");
      setLoading(false);
      return;
    }
    toast.success("Access revoked");
    await router.invalidate();
    setLoading(false);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "text-destructive hover:text-destructive-hover",
        )}
      >
        Revoke Access
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke Access</AlertDialogTitle>
          <AlertDialogDescription>
            This application will lose access to your account and will need to request authorization
            again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={cn(buttonVariants({ variant: "ghost" }))}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={handleRevoke}
            disabled={loading}
          >
            {loading ? "Revoking\u2026" : "Revoke"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
