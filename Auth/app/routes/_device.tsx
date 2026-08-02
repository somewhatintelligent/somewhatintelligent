import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_device")({
  component: DeviceLayout,
});

function DeviceLayout() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-page">
      <div className="w-full max-w-[560px]">
        <Outlet />
      </div>
    </main>
  );
}
