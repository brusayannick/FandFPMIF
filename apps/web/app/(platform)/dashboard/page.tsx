import { DashboardView } from "./DashboardView";

export default function DashboardPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-text-muted">
            Platform-level analytics and recent activity.
          </p>
        </header>
        <DashboardView />
      </div>
    </div>
  );
}
