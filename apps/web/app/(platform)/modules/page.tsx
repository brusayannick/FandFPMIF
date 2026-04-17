import { ModulesView } from "./ModulesView";

export default function ModulesPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Modules</h1>
          <p className="mt-1 text-sm text-text-muted">
            Built-in and third-party analytical modules.
          </p>
        </header>
        <ModulesView />
      </div>
    </div>
  );
}
