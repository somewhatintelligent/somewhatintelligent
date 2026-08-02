import { createFileRoute } from "@tanstack/react-router";
import { getStats } from "@/lib/admin.functions";

export const Route = createFileRoute("/_dashboard/admin/")({
  loader: () => getStats(),
  head: () => ({ meta: [{ title: "Admin — Identity" }] }),
  component: AdminDashboardPage,
});

function AdminDashboardPage() {
  const data = Route.useLoaderData();
  const stats = [
    { label: "Users", value: data.users },
    { label: "Sessions", value: data.sessions, note: "active" },
    { label: "Clients", value: data.clients, note: "registered" },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-grid">
        <h1 className="type-page-title">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">The state of things, such as it is.</p>
      </div>

      <div className="grid grid-cols-3 gap-grid">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-sm bg-surface-sunken px-4 py-3">
            <div className="type-mono-label text-muted-foreground/80">{stat.label}</div>
            <div className="type-stat mt-1">{stat.value.toLocaleString()}</div>
            {stat.note && <div className="mt-2 text-xs text-muted-foreground/80">{stat.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
