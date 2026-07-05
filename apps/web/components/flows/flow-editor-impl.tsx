"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useStoreApi,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { BarChart3, Boxes, Check, Database, Filter, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEventLogs } from "@/lib/queries";
import {
  useUpdateFlow,
  type FlowDetail,
  type FlowGraph,
  type FlowNode,
  type FlowNodeType,
} from "@/lib/flow-queries";

import { FlowEditorContext, type FlowEditorContextValue } from "./flow-context";
import { flowNodeTypes } from "./flow-nodes";
import { NodeInspector } from "./node-inspector";

import "@xyflow/react/dist/style.css";

type StoreApi = ReturnType<typeof useStoreApi>;
type StoreRef = MutableRefObject<StoreApi | null>;

const ADD_BUTTONS: { type: FlowNodeType; label: string; icon: typeof Database }[] = [
  { type: "source", label: "Event log", icon: Database },
  { type: "module", label: "Module", icon: Boxes },
  { type: "transform", label: "Transform", icon: Filter },
  { type: "viz", label: "Visualization", icon: BarChart3 },
];

function toRf(graph: FlowGraph): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    })),
  };
}

/**
 * Rendered as a CHILD of <ReactFlow>, so `useStoreApi()` resolves React Flow's
 * own inner store - the one that actually renders. (`useStoreApi` called from a
 * parent returns a different/outer store, so seeds set there never appear.) It
 * lifts the store up via `storeRef` and seeds it while empty.
 */
function StoreBridge({
  storeRef,
  seed,
  onSeed,
}: {
  storeRef: StoreRef;
  seed: { nodes: Node[]; edges: Edge[] };
  onSeed: () => void;
}) {
  const store = useStoreApi();
  useEffect(() => {
    storeRef.current = store;
    const seedIfEmpty = () => {
      const st = store.getState();
      if (st.nodes.length === 0 && seed.nodes.length > 0) {
        st.setNodes(seed.nodes);
        st.setEdges(seed.edges);
        onSeed();
      }
    };
    seedIfEmpty();
    // RF's ResizeObserver can report the container as 0x0 on mount (nodes never
    // render at zero size); re-seed + nudge a resize as layout settles.
    const timers = [80, 250, 600].map((ms) =>
      setTimeout(() => {
        seedIfEmpty();
        window.dispatchEvent(new Event("resize"));
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [store, seed, storeRef, onSeed]);
  return null;
}

export function FlowEditor({ flow }: { flow: FlowDetail }) {
  const seed = useMemo(() => toRf(flow.graph), [flow.graph]);
  const storeRef = useRef<StoreApi | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const update = useUpdateFlow(flow.id);
  const updateRef = useRef(update);
  updateRef.current = update;

  const { data: logs } = useEventLogs({ status: "ready" });
  const bindableLogs = (logs ?? []).filter((l) => l.log_model === flow.log_model);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const st = storeRef.current?.getState();
      if (!st) return;
      const graph: FlowGraph = {
        nodes: st.nodes.map((n) => ({
          id: n.id,
          type: (n.type ?? "module") as FlowNodeType,
          position: n.position,
          data: (n.data ?? {}) as Record<string, unknown>,
        })),
        edges: st.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
        })),
      };
      updateRef.current.mutate({ graph }, { onSuccess: () => setVersion((v) => v + 1) });
    }, 600);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      bump();
      if (changes.some((c) => c.type === "position" || c.type === "remove" || c.type === "add")) {
        scheduleSave();
      }
    },
    [bump, scheduleSave],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      bump();
      if (changes.some((c) => c.type === "remove" || c.type === "add")) scheduleSave();
    },
    [bump, scheduleSave],
  );
  const onConnect = useCallback(
    (c: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null }) => {
      const st = storeRef.current?.getState();
      if (!st || !c.source || !c.target) return;
      st.setEdges([
        ...st.edges,
        {
          id: `${c.source}-${c.target}-${Math.round(performance.now())}`,
          source: c.source,
          target: c.target,
          sourceHandle: c.sourceHandle ?? undefined,
          targetHandle: c.targetHandle ?? undefined,
          animated: true,
        },
      ]);
      bump();
      scheduleSave();
    },
    [bump, scheduleSave],
  );

  const addNode = useCallback(
    (type: FlowNodeType) => {
      const st = storeRef.current?.getState();
      if (!st) return;
      const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `n-${Date.now()}`;
      st.setNodes([
        ...st.nodes,
        { id, type, position: { x: 80 + st.nodes.length * 36, y: 70 + st.nodes.length * 28 }, data: {} },
      ]);
      bump();
      scheduleSave();
    },
    [bump, scheduleSave],
  );

  const patchNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const st = storeRef.current?.getState();
      if (!st) return;
      st.setNodes(st.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
      bump();
      scheduleSave();
    },
    [bump, scheduleSave],
  );

  void tick;
  const st = storeRef.current?.getState();
  const selectedNode = (selectedNodeId && st
    ? (st.nodes.find((n) => n.id === selectedNodeId) ?? null)
    : null) as FlowNode | null;
  const upstreamNodeId =
    selectedNodeId && st
      ? st.edges.find((e) => e.target === selectedNodeId)?.source ?? null
      : null;

  const ctx = useMemo<FlowEditorContextValue>(
    () => ({
      flowId: flow.id,
      version,
      hasLog: !!flow.event_log_id,
      selectNode: setSelectedNodeId,
      patchNodeData,
    }),
    [flow.id, flow.event_log_id, version, patchNodeData],
  );

  return (
    <FlowEditorContext.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Log:</span>
          <Select
            value={flow.event_log_id ?? ""}
            onValueChange={(id) =>
              updateRef.current.mutate({ event_log_id: id }, { onSuccess: () => setVersion((v) => v + 1) })
            }
          >
            <SelectTrigger className="h-7 w-44 text-xs">
              <SelectValue placeholder="Bind an event log" />
            </SelectTrigger>
            <SelectContent>
              {bindableLogs.map((l) => (
                <SelectItem key={l.id} value={l.id} className="text-xs">
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="mx-1 h-4 w-px bg-border" />
          <span className="text-xs font-medium text-muted-foreground">Add:</span>
          {ADD_BUTTONS.map((b) => (
            <Button
              key={b.type}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => addNode(b.type)}
            >
              <b.icon className="h-3.5 w-3.5" />
              {b.label}
            </Button>
          ))}
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {update.isPending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Check className="h-3 w-3" /> Saved
              </>
            )}
          </span>
        </div>
        <div className="flex min-h-0 flex-1">
          {/* `relative` + an `absolute inset-0` child give React Flow a
              definite-size box its ResizeObserver can measure - a flex-derived
              height can read as 0x0 at init, leaving nodes unrendered. */}
          <div className="relative min-w-0 flex-1">
            <div className="absolute inset-0">
              <ReactFlow
                defaultNodes={seed.nodes}
                defaultEdges={seed.edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={flowNodeTypes}
                onNodeClick={(_, n) => setSelectedNodeId(n.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                fitView
                proOptions={{ hideAttribution: true }}
              >
                <StoreBridge storeRef={storeRef} seed={seed} onSeed={bump} />
                <Background gap={16} className="text-border" />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable className="!bg-muted" />
              </ReactFlow>
            </div>
          </div>
          <div className="w-72 shrink-0 overflow-y-auto border-l border-border bg-muted/20">
            <NodeInspector
              flowId={flow.id}
              version={version}
              logModel={flow.log_model}
              node={selectedNode}
              upstreamNodeId={upstreamNodeId}
              patchNodeData={patchNodeData}
            />
          </div>
        </div>
      </div>
    </FlowEditorContext.Provider>
  );
}
