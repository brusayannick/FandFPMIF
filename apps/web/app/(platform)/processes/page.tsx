import { ProcessesView } from "./ProcessesView";

export default function ProcessesPage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <ProcessesView />
      </div>
    </div>
  );
}
