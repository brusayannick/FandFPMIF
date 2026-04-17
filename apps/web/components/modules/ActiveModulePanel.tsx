"use client";

import { Blocks } from "lucide-react";
import { useProcessStore } from "@/stores/process.store";
import { useUIStore } from "@/stores/ui.store";
import { getModule, listModules } from "./registry";

interface ActiveModulePanelProps {
  processId: string;
}

export function ActiveModulePanel({ processId }: ActiveModulePanelProps) {
  const activeModuleId = useUIStore((s) => s.activeModuleId);
  const setActiveModuleId = useUIStore((s) => s.setActiveModuleId);
  const nodes = useProcessStore((s) => s.nodes);
  const edges = useProcessStore((s) => s.edges);
  const selectedNodeId = useUIStore((s) => s.selectedNodeId);
  const updateNodeData = useProcessStore((s) => s.updateNodeData);

  const active = getModule(activeModuleId);

  if (!active) {
    const available = listModules();
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-surface-2 text-text-muted">
          <Blocks size={16} />
        </div>
        <div>
          <div className="text-sm">No module selected</div>
          <p className="mt-0.5 text-xs text-text-muted">
            Activate a module to analyse, simulate, or import into this
            process.
          </p>
        </div>
        <div className="flex w-full max-w-[260px] flex-col gap-1">
          {available.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.moduleId}
                type="button"
                onClick={() => setActiveModuleId(m.moduleId)}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-offset hover:text-text"
              >
                <Icon size={14} className="shrink-0" />
                <span className="flex-1 truncate">{m.displayName}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const Panel = active.panelComponent;
  return (
    <Panel
      processId={processId}
      nodes={nodes}
      edges={edges}
      selectedNodeId={selectedNodeId}
      onNodeUpdate={updateNodeData}
    />
  );
}
