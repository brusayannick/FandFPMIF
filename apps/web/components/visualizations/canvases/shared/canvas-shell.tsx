"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type EdgeTypes,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowProps,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import { Maximize2, Minus, Plus } from "lucide-react";

interface CanvasShellProps {
  nodes: Node[];
  edges: Edge[];
  nodeTypes?: NodeTypes;
  edgeTypes?: EdgeTypes;
  fitViewKey?: string | number;
  className?: string;
  miniMap?: boolean;
  showGrid?: boolean;
  toolbarSlot?: ReactNode;
  /** Optional content rendered as an absolute-positioned overlay on top of
   *  the canvas — used for the click-to-inspect details panel. */
  overlay?: ReactNode;
  proOptions?: ReactFlowProps["proOptions"];
  onNodeClick?: NodeMouseHandler;
  onEdgeClick?: EdgeMouseHandler;
  onPaneClick?: (event: React.MouseEvent) => void;
  // The canvas component (DfgCanvas, etc.) parameterises its own state with
  // a specific `Node<TData>` — the shell doesn't need to know which, so we
  // accept the generic-erased forms.
  onNodesChange?: OnNodesChange<Node>;
  onEdgesChange?: OnEdgesChange<Edge>;
  onNodeDragStop?: NodeMouseHandler;
}

// Minimap node colors are pre-resolved RGB so they render reliably as SVG
// `fill` attributes (CSS vars + oklch() in SVG presentation attributes is
// inconsistent across browsers — a CSS class would also work, but we want
// per-node-type tinting).
const NODE_TYPE_COLORS: Record<string, string> = {
  activity: "rgb(99, 102, 241)",       // indigo-500 — distinct in both themes
  place: "rgb(148, 163, 184)",         // slate-400
  transition: "rgb(71, 85, 105)",      // slate-600
  pt_operator: "rgb(168, 85, 247)",    // purple-500
  pt_leaf: "rgb(148, 163, 184)",       // slate-400
};

const minimapNodeColor = (node: Node): string =>
  (node.type && NODE_TYPE_COLORS[node.type]) ?? "rgb(100, 116, 139)";

function CanvasInner({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  fitViewKey,
  miniMap = true,
  showGrid = true,
  toolbarSlot,
  overlay,
  proOptions,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onNodesChange,
  onEdgesChange,
  onNodeDragStop,
}: Omit<CanvasShellProps, "className">) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const lastKey = useRef<string | number | undefined>(undefined);

  useEffect(() => {
    if (fitViewKey !== lastKey.current) {
      lastKey.current = fitViewKey;
      // Defer to next paint so dagre positions are committed first.
      const id = requestAnimationFrame(() => fitView({ duration: 200, padding: 0.2 }));
      return () => cancelAnimationFrame(id);
    }
  }, [fitViewKey, fitView]);

  const onFit = useCallback(() => fitView({ duration: 200, padding: 0.2 }), [fitView]);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        proOptions={proOptions ?? { hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        nodesFocusable
        edgesFocusable
        elementsSelectable
        selectNodesOnDrag={false}
        zoomOnScroll
        panOnScroll
        fitView
        minZoom={0.1}
        maxZoom={2}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        defaultEdgeOptions={{
          interactionWidth: 24,
          focusable: true,
          selectable: true,
        }}
      >
        {showGrid && (
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-background" />
        )}
        <Controls showInteractive={false} className="!border-border !bg-card" />
        {miniMap && (
          <MiniMap
            pannable
            zoomable
            className="!border !border-border !bg-card !rounded-md overflow-hidden shadow-sm"
            maskColor="rgba(0, 0, 0, 0.15)"
            maskStrokeColor="rgba(0, 0, 0, 0.4)"
            maskStrokeWidth={1}
            nodeColor={minimapNodeColor}
            nodeStrokeColor="rgba(0, 0, 0, 0.6)"
            nodeStrokeWidth={2}
            nodeBorderRadius={3}
            offsetScale={4}
          />
        )}
      </ReactFlow>

      <div className="pointer-events-none absolute right-3 top-3 flex gap-1.5">
        <div className="pointer-events-auto flex items-center gap-1 rounded-md border bg-card/80 p-1 shadow-sm backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={() => zoomOut({ duration: 150 })}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={() => zoomIn({ duration: 150 })}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={onFit}
            aria-label="Fit to view"
            title="Fit to view"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          {toolbarSlot}
        </div>
      </div>

      {overlay}
    </div>
  );
}

export function CanvasShell(props: CanvasShellProps) {
  return (
    <div className={props.className ?? "h-[640px] w-full overflow-hidden rounded-xl border bg-card"}>
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
