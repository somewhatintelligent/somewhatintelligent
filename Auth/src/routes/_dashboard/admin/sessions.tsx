import { createFileRoute } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@si/ui/components/avatar";
import { getSessions } from "@/lib/admin-sessions.functions";

export const Route = createFileRoute("/_dashboard/admin/sessions")({
  loader: () => getSessions(),
  head: () => ({ meta: [{ title: "Sessions — Admin" }] }),
  component: SessionsPage,
});

function SessionsPage() {
  const { sessions } = Route.useLoaderData();

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-section">
        <h1 className="type-page-title">Sessions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Active sessions. Each one a small thread of trust, held open until it expires or is
          revoked.
        </p>
      </div>

      <div className="flex-1 overflow-x-auto rounded-sm border-2 border-border-strong">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border-strong bg-surface-sunken">
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                User
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                IP
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Created
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Expires
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground/80">
                  No active sessions. It follows that nobody is currently authenticated.
                </td>
              </tr>
            )}
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar size="sm">
                      {s.userImage ? <AvatarImage src={s.userImage} alt="" /> : null}
                      <AvatarFallback>{s.userName?.charAt(0).toUpperCase() ?? "?"}</AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium">{s.userName ?? "Unknown"}</div>
                      <div className="font-mono text-xs text-muted-foreground/80">
                        {s.userEmail}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground/80">
                  {s.ipAddress ?? "\u2014"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground/80">
                  {s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-US") : "\u2014"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground/80">
                  {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString("en-US") : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
