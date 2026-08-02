import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@si/ui/components/badge";
import { Button } from "@si/ui/components/button";
import { isManaged } from "@/lib/clients";
import { getClients } from "@/lib/admin-clients.functions";

export const Route = createFileRoute("/_dashboard/admin/clients/")({
  loader: () => getClients(),
  head: () => ({ meta: [{ title: "OAuth Clients — Admin" }] }),
  component: ClientsPage,
});

function ClientsPage() {
  const { clients } = Route.useLoaderData();

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-section flex items-baseline justify-between">
        <div>
          <h1 className="type-page-title">OAuth Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The applications that have been granted the privilege of asking you who you are.
          </p>
        </div>
        <Link to="/admin/clients/new">
          <Button size="sm">Add Client</Button>
        </Link>
      </div>

      <div className="flex-1 overflow-x-auto rounded-sm border-2 border-border-strong">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border-strong bg-surface-sunken">
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Name
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Client ID
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Type
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground/80">
                  No clients registered. The identity provider awaits its supplicants.
                </td>
              </tr>
            )}
            {clients.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Link
                    to="/admin/clients/$id"
                    params={{ id: c.id }}
                    className="font-medium hover:text-primary"
                  >
                    {c.name ?? c.clientId}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground/80">
                  {c.clientId}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="secondary">{c.type ?? "web"}</Badge>
                </td>
                <td className="px-4 py-3">
                  {isManaged(c.referenceId) ? (
                    <Badge variant="warning">Managed</Badge>
                  ) : (
                    <Badge variant="default">Custom</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
