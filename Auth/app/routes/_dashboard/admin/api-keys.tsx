import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@si/ui/components/badge";
import { getApiKeys } from "@/lib/admin.functions";

export const Route = createFileRoute("/_dashboard/admin/api-keys")({
  loader: () => getApiKeys(),
  head: () => ({ meta: [{ title: "API Keys — Admin" }] }),
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const { apiKeys } = Route.useLoaderData();

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-section">
        <h1 className="type-page-title">API Keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every key someone made. Whether they should have is another matter.
        </p>
      </div>

      <div className="flex-1 overflow-x-auto rounded-sm border-2 border-border-strong">
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border-strong bg-surface-sunken">
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Name
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Owner
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Prefix
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Enabled
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-muted-foreground/80">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {apiKeys.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground/80">
                  No API keys yet. One would imagine that will change.
                </td>
              </tr>
            )}
            {apiKeys.map((k) => (
              <tr key={k.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">{k.name ?? "Unnamed"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground/80">
                  {k.ownerEmail ?? "Unknown"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground/80">
                  {k.prefix ?? "\u2014"}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={k.enabled ? "success" : "secondary"}>
                    {k.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground/80">
                  {k.createdAt ? new Date(k.createdAt).toLocaleDateString("en-US") : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
