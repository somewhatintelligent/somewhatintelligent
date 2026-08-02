import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@si/ui/components/badge";
import { Button } from "@si/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@si/ui/components/card";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemGroup,
} from "@si/ui/components/item";
import { toast } from "@si/ui/components/sonner";
import { authClient } from "@/lib/auth-client";

interface SessionInfo {
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: Date;
  isCurrent?: boolean;
}

export const Route = createFileRoute("/_dashboard/account/sessions")({
  head: () => ({ meta: [{ title: "Sessions — Identity" }] }),
  component: SessionsPage,
});

function SessionsPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  async function fetchSessions() {
    setLoading(true);
    const result = await authClient.listSessions();
    if (result.data) {
      setSessions(result.data as unknown as SessionInfo[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchSessions();
  }, []);

  function handleRevoke(token: string) {
    startTransition(async () => {
      const result = await authClient.revokeSession({ token });
      if (result.error) {
        toast.error(result.error.message ?? "Failed to revoke session");
        return;
      }
      await fetchSessions();
    });
  }

  function handleRevokeOthers() {
    startTransition(async () => {
      const result = await authClient.revokeOtherSessions();
      if (result.error) {
        toast.error(result.error.message ?? "Failed to revoke sessions");
        return;
      }
      toast.success("Other sessions revoked");
      await fetchSessions();
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-grid">
        <h1 className="type-page-title">Sessions</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Sessions</CardTitle>
          <CardDescription>
            Each one a small thread of trust, held open until it expires or is revoked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground/80">Loading sessions{"\u2026"}</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground/80">
              No active sessions. One would imagine you are a ghost.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <ItemGroup>
                {sessions.map((s) => (
                  <Item key={s.token} variant="surface" size="sm">
                    <ItemContent>
                      <ItemTitle>
                        <span className="flex items-center gap-2">
                          {s.userAgent?.slice(0, 40) ?? "Unknown device"}
                          {s.isCurrent && (
                            <Badge variant="default" size="sm">
                              Current
                            </Badge>
                          )}
                        </span>
                      </ItemTitle>
                      <ItemDescription>
                        {s.ipAddress ?? "—"} · {new Date(s.createdAt).toLocaleDateString()}
                      </ItemDescription>
                    </ItemContent>
                    {!s.isCurrent && (
                      <ItemActions>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevoke(s.token)}
                          disabled={isPending}
                        >
                          Revoke
                        </Button>
                      </ItemActions>
                    )}
                  </Item>
                ))}
              </ItemGroup>
              {sessions.length > 1 && (
                <Button
                  variant="outline"
                  className="w-full justify-center"
                  onClick={handleRevokeOthers}
                  disabled={isPending}
                >
                  Revoke All Other Sessions
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
