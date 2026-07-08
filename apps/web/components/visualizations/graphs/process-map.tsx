"use client";

import { useEffect, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { GraphData, VizComponentProps } from "@/lib/visualizations/types";
import { VizEmpty } from "@/components/visualizations/viz-shell";
import {
  CanvasFullscreenButton,
  useCanvasIdleVisibility,
  useFullscreen,
} from "@/components/visualizations/canvases/shared/canvas-controls";

import "@xyflow/react/dist/style.css";

const elk = new ELK();
const NODE_W = 160;
const NODE_H = 40;
const PLACE = 22;

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "60",
  "elk.spacing.nodeNode": "28",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
} as const;

async function layout(g: GraphData): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const children: ElkNode[] = g.nodes.map((n) => ({
    id: n.id,
    width: n.kind === "place" ? PLACE : NODE_W,
    height: n.kind === "place" ? PLACE : NODE_H,
  }));
  const elkEdges: ElkExtendedEdge[] = g.edges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));
  const res = await elk.layout({ id: "root", layoutOptions: LAYOUT_OPTIONS, children, edges: elkEdges });
  const pos = new Map<string, { x: number; y: number }>();
  for (const c of res.children ?? []) {
    if (typeof c.x === "number" && typeof c.y === "number") pos.set(c.id, { x: c.x, y: c.y });
  }

  const maxFreq = Math.max(1, ...g.nodes.map((n) => n.value ?? 0));
  const nodes: Node[] = g.nodes.map((n) => {
    const isPlace = n.kind === "place";
    const t = (n.value ?? 0) / maxFreq;
    return {
      id: n.id,
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: { label: n.label },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      style: isPlace
        ? {
            width: PLACE,
            height: PLACE,
            borderRadius: "50%",
            background: "var(--muted)",
            border: "1px solid var(--border)",
          }
        : {
            width: NODE_W,
            height: NODE_H,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: `rgba(99,102,241,${0.06 + t * 0.5})`,
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 8px",
            textAlign: "center" as const,
            lineHeight: 1.1,
          },
    };
  });

  const maxEdge = Math.max(1, ...g.edges.map((e) => e.value ?? 0));
  const edges: Edge[] = g.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.value != null ? formatNumber(e.value) : undefined,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    style: { strokeWidth: 1 + 3 * ((e.value ?? 0) / maxEdge), stroke: "var(--muted-foreground)" },
    labelStyle: { fontSize: 9, fill: "var(--muted-foreground)" },
    labelBgStyle: { fill: "var(--card)", fillOpacity: 0.85 },
  }));
  return { nodes, edges };
}

/** Read-only node-link process map for a `graph`-shaped dataset (DFG, heuristics
 * net, Petri net), laid out with ELK and rendered with React Flow. Node shade =
 * frequency, edge width = transition frequency. */
export function ProcessMapViz({ dataset }: VizComponentProps) {
  const graph = dataset.shape === "graph" ? (dataset.data as GraphData) : null;
  // `dataset` is memoized per fetch by the card, so `graph` is a stable ref and
  // the layout effect runs once per data change (not every render).
  const [state, setState] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!graph || graph.nodes.length === 0) {
      setState(null);
      return;
    }
    layout(graph)
      .then((r) => alive && setState(r))
      .catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, [graph]);

  const rootRef = useRef<HTMLDivElement>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(rootRef);
  // Minimap hidden by default; fades in only while the user pans/zooms.
  const { visible: minimapVisible, notifyActivity } = useCanvasIdleVisibility({ idleMs: 1200 });

  // Re-fit when entering/leaving fullscreen (viewport resized). Skip mount.
  const didMountFs = useRef(false);
  useEffect(() => {
    if (!didMountFs.current) {
      didMountFs.current = true;
      return;
    }
    const id = requestAnimationFrame(() => rfRef.current?.fitView({ duration: 200, padding: 0.2 }));
    return () => cancelAnimationFrame(id);
  }, [isFullscreen]);

  if (!graph || graph.nodes.length === 0) {
    return <VizEmpty message={dataset.meta?.note ?? "No process model."} />;
  }
  if (!state) return <VizEmpty message="Laying out…" />;

  return (
    <div
      ref={rootRef}
      className={cn("relative h-full w-full", isFullscreen && "bg-background")}
      onWheelCapture={notifyActivity}
      onPointerDownCapture={notifyActivity}
    >
      <ReactFlow
        nodes={state.nodes}
        edges={state.edges}
        fitView
        minZoom={0.05}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onInit={(inst) => {
          rfRef.current = inst;
        }}
        onMoveStart={notifyActivity}
        onMove={notifyActivity}
      >
        <Background gap={16} className="text-border" />
        <Controls showInteractive={false} />
        <div
          className={cn(
            "transition-opacity duration-300",
            minimapVisible ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <MiniMap
            pannable
            zoomable
            className="!border !border-border !bg-card !rounded-md overflow-hidden shadow-sm"
            maskColor="rgba(0, 0, 0, 0.15)"
            nodeColor={() => "rgb(148, 163, 184)"}
            nodeStrokeColor="rgba(0, 0, 0, 0.6)"
            nodeStrokeWidth={2}
            nodeBorderRadius={3}
          />
        </div>
      </ReactFlow>
      <div className="pointer-events-none absolute right-3 top-3 flex gap-1.5">
        <div className="pointer-events-auto flex items-center gap-1 rounded-md border bg-card/80 p-1 shadow-sm backdrop-blur">
          <CanvasFullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
        </div>
      </div>
    </div>
  );
}
