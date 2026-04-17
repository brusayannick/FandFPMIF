"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { useCallback, useRef, useState } from "react";
import { nodeColorMap, nodeTypes } from "./nodes";
import { edgeTypes } from "./edges/SequenceEdge";
import { useProcessStore } from "@/stores/process.store";
import { useUIStore } from "@/stores/ui.store";
import type { NodeKind } from "@/lib/schemas/graph";
import {
  CanvasContextMenu,
  type ContextMenuTarget,
} from "./CanvasContextMenu";

export function ProcessCanvas() {
  const nodes = useProcessStore((s) => s.nodes);
  const edges = useProcessStore((s) => s.edges);
  const onNodesChange = useProcessStore((s) => s.onNodesChange);
  const onEdgesChange = useProcessStore((s) => s.onEdgesChange);
  const onConnect = useProcessStore((s) => s.onConnect);
  const addNode = useProcessStore((s) => s.addNode);
  const removeSelected = useProcessStore((s) => s.removeSelected);

  const setSelectedNodeId = useUIStore((s) => s.setSelectedNodeId);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const [contextMenu, setContextMenu] = useState<{
    target: ContextMenuTarget;
    position: { x: number; y: number };
  } | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(
        "application/reactflow",
      ) as NodeKind;
      if (!kind) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addNode(kind, position);
    },
    [addNode, screenToFlowPosition],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      setSelectedNodeId(selectedNodes[0]?.id ?? null);
    },
    [setSelectedNodeId],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        removeSelected();
      }
    },
    [removeSelected],
  );

  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault();
      setContextMenu({
        target: {
          kind: "node",
          id: node.id,
          nodeType: node.type ?? "task",
          label: (node.data as { label?: string }).label ?? node.id,
        },
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [],
  );

  const onEdgeContextMenu: EdgeMouseHandler = useCallback(
    (event, edge) => {
      event.preventDefault();
      setContextMenu({
        target: {
          kind: "edge",
          id: edge.id,
          label: typeof edge.label === "string" ? edge.label : undefined,
        },
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [],
  );

  const onPaneClick = useCallback(() => {
    closeContextMenu();
  }, [closeContextMenu]);

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full outline-none"
      onDragOver={onDragOver}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "sequence" }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background
          color="var(--border)"
          gap={20}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <Controls
          showInteractive={false}
          className="!bg-surface !border-border rounded-md"
        />
        <MiniMap
          nodeColor={(n) => nodeColorMap[n.type ?? "task"] ?? "var(--primary)"}
          maskColor="rgba(14,14,15,0.6)"
          className="!bg-surface !border !border-border rounded-lg"
          pannable
          zoomable
        />
      </ReactFlow>

      {contextMenu && (
        <CanvasContextMenu
          target={contextMenu.target}
          position={contextMenu.position}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
