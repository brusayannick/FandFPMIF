"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProcessStore } from "@/stores/process.store";
import { useUIStore } from "@/stores/ui.store";
import type { NodeData } from "@/lib/schemas/graph";
import { Inbox } from "lucide-react";
import { ActiveModulePanel } from "@/components/modules/ActiveModulePanel";

interface PropertiesPanelProps {
  processId: string;
}

export function PropertiesPanel({ processId }: PropertiesPanelProps) {
  const selectedNodeId = useUIStore((s) => s.selectedNodeId);
  const activeTab = useUIStore((s) => s.activePanelTab);
  const setTab = useUIStore((s) => s.setActivePanelTab);

  const node = useProcessStore((s) =>
    selectedNodeId ? s.nodes.find((n) => n.id === selectedNodeId) : null,
  );
  const updateNodeData = useProcessStore((s) => s.updateNodeData);

  function patch(p: Partial<NodeData>) {
    if (!node) return;
    updateNodeData(node.id, p);
  }

  return (
    <aside
      aria-label="Properties panel"
      className="flex h-full w-[320px] shrink-0 flex-col border-l bg-surface"
    >
      <Tabs
        value={activeTab}
        onValueChange={(v) => setTab(v as typeof activeTab)}
        className="flex h-full flex-col"
      >
        <div className="border-b px-2 pt-2">
          <TabsList className="grid w-full grid-cols-3 bg-surface-2">
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="properties"
          className="flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden"
        >
          {node ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="text-[10px] font-medium uppercase tracking-wider text-text-faint">
                  Node
                </div>
                <div className="text-[11px] text-text-muted">
                  {node.id} — <span className="capitalize">{node.type}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="node-label" className="text-xs">
                  Label
                </Label>
                <Input
                  id="node-label"
                  value={(node.data as NodeData).label ?? ""}
                  onChange={(e) => patch({ label: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="node-description" className="text-xs">
                  Description
                </Label>
                <Input
                  id="node-description"
                  value={(node.data as NodeData).description ?? ""}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder="Optional"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="node-duration" className="text-xs">
                    Duration (ms)
                  </Label>
                  <Input
                    id="node-duration"
                    type="number"
                    min={0}
                    value={(node.data as NodeData).duration_ms ?? ""}
                    onChange={(e) =>
                      patch({
                        duration_ms:
                          e.target.value === ""
                            ? null
                            : Math.max(0, Number(e.target.value)),
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="node-cost" className="text-xs">
                    Cost
                  </Label>
                  <Input
                    id="node-cost"
                    type="number"
                    step="0.01"
                    min={0}
                    value={(node.data as NodeData).cost ?? ""}
                    onChange={(e) =>
                      patch({
                        cost:
                          e.target.value === ""
                            ? null
                            : Math.max(0, Number(e.target.value)),
                      })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="node-assignee" className="text-xs">
                  Assignee
                </Label>
                <Input
                  id="node-assignee"
                  value={(node.data as NodeData).assignee ?? ""}
                  onChange={(e) => patch({ assignee: e.target.value })}
                  placeholder="role or team"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <div className="flex flex-wrap gap-1">
                  {(["idle", "active", "blocked", "done"] as const).map((s) => {
                    const active = (node.data as NodeData).status === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => patch({ status: s })}
                        className={
                          "cursor-pointer rounded-md border px-2 py-1 text-[11px] capitalize " +
                          (active
                            ? "border-primary bg-primary-highlight text-text"
                            : "border-border text-text-muted hover:bg-surface-offset")
                        }
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No selection"
              body="Select a node on the canvas to edit its properties."
            />
          )}
        </TabsContent>

        <TabsContent
          value="analysis"
          className="flex-1 min-h-0 overflow-hidden data-[state=inactive]:hidden"
        >
          <ActiveModulePanel processId={processId} />
        </TabsContent>

        <TabsContent
          value="history"
          className="flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden"
        >
          <EmptyState
            title="No executions yet"
            body="Process instance history will appear here after the first run."
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-surface-2 text-text-muted">
        <Inbox size={16} />
      </div>
      <div className="text-sm text-text">{title}</div>
      <p className="max-w-[220px] text-xs text-text-muted">{body}</p>
    </div>
  );
}
