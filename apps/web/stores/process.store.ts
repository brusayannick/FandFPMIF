"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { create } from "zustand";
import type {
  Graph,
  NodeData,
  NodeKind,
  ServerEdge,
  ServerNode,
} from "@/lib/schemas/graph";

export type ProcessNode = Node<NodeData, NodeKind>;
export type ProcessEdge = Edge;

function nodeFromServer(n: ServerNode): ProcessNode {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
    width: n.width ?? undefined,
    height: n.height ?? undefined,
  };
}

function edgeFromServer(e: ServerEdge): ProcessEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    label: e.label ?? undefined,
    data: e.data ?? undefined,
    animated: e.animated ?? false,
    type: "sequence",
  };
}

function nodeToServer(n: ProcessNode): ServerNode {
  return {
    id: n.id,
    type: (n.type ?? "task") as NodeKind,
    position: { x: n.position.x, y: n.position.y },
    data: n.data,
    width: typeof n.width === "number" ? n.width : null,
    height: typeof n.height === "number" ? n.height : null,
  };
}

function edgeToServer(e: ProcessEdge): ServerEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    label: typeof e.label === "string" ? e.label : null,
    data:
      (e.data as Record<string, unknown> | undefined | null) ?? null,
    animated: e.animated ?? false,
  };
}

interface ProcessStore {
  processId: string | null;
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  isDirty: boolean;

  setProcessId: (id: string | null) => void;

  onNodesChange: (changes: NodeChange<ProcessNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<ProcessEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  addNode: (kind: NodeKind, position: { x: number; y: number }) => string;
  updateNodeData: (nodeId: string, patch: Partial<NodeData>) => void;
  removeSelected: () => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  duplicateNode: (id: string) => string | null;

  syncFromServer: (graph: Graph) => void;
  serializeForServer: () => Graph;
  reset: () => void;
  markClean: () => void;
}

const defaultLabels: Record<NodeKind, string> = {
  startEvent: "Start",
  endEvent: "End",
  intermediateEvent: "Event",
  task: "Task",
  userTask: "User task",
  serviceTask: "Service task",
  scriptTask: "Script task",
  gateway: "Gateway",
  exclusiveGateway: "Exclusive",
  parallelGateway: "Parallel",
  inclusiveGateway: "Inclusive",
  subprocess: "Subprocess",
};

function uid(prefix: string): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useProcessStore = create<ProcessStore>((set, get) => ({
  processId: null,
  nodes: [],
  edges: [],
  isDirty: false,

  setProcessId: (id) => set({ processId: id }),

  onNodesChange: (changes) =>
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes),
      isDirty: s.isDirty || changes.some(meaningfulNodeChange),
    })),

  onEdgesChange: (changes) =>
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges),
      isDirty: s.isDirty || changes.some(meaningfulEdgeChange),
    })),

  onConnect: (connection) =>
    set((s) => ({
      edges: addEdge(
        { ...connection, type: "sequence", id: uid("e") },
        s.edges,
      ),
      isDirty: true,
    })),

  addNode: (kind, position) => {
    const id = uid("n");
    const newNode: ProcessNode = {
      id,
      type: kind,
      position,
      data: { label: defaultLabels[kind], status: "idle" },
    };
    set((s) => ({ nodes: [...s.nodes, newNode], isDirty: true }));
    return id;
  },

  updateNodeData: (nodeId, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
      isDirty: true,
    })),

  removeSelected: () =>
    set((s) => {
      const keepNodes = s.nodes.filter((n) => !n.selected);
      const keepIds = new Set(keepNodes.map((n) => n.id));
      const keepEdges = s.edges.filter(
        (e) => !e.selected && keepIds.has(e.source) && keepIds.has(e.target),
      );
      return {
        nodes: keepNodes,
        edges: keepEdges,
        isDirty: true,
      };
    }),

  removeNode: (id) =>
    set((s) => {
      const keepNodes = s.nodes.filter((n) => n.id !== id);
      const keepIds = new Set(keepNodes.map((n) => n.id));
      return {
        nodes: keepNodes,
        edges: s.edges.filter(
          (e) => keepIds.has(e.source) && keepIds.has(e.target),
        ),
        isDirty: true,
      };
    }),

  removeEdge: (id) =>
    set((s) => ({
      edges: s.edges.filter((e) => e.id !== id),
      isDirty: true,
    })),

  duplicateNode: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return null;
    const newId = uid("n");
    const newNode: ProcessNode = {
      ...node,
      id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      selected: false,
    };
    set((s) => ({ nodes: [...s.nodes, newNode], isDirty: true }));
    return newId;
  },

  syncFromServer: (graph) =>
    set({
      nodes: graph.nodes.map(nodeFromServer),
      edges: graph.edges.map(edgeFromServer),
      isDirty: false,
    }),

  serializeForServer: () => ({
    nodes: get().nodes.map(nodeToServer),
    edges: get().edges.map(edgeToServer),
  }),

  reset: () => set({ nodes: [], edges: [], isDirty: false, processId: null }),
  markClean: () => set({ isDirty: false }),
}));

function meaningfulNodeChange(change: NodeChange<ProcessNode>): boolean {
  if (change.type === "select" || change.type === "dimensions") return false;
  if (change.type === "position" && change.dragging === true) return false;
  return true;
}

function meaningfulEdgeChange(change: EdgeChange<ProcessEdge>): boolean {
  if (change.type === "select") return false;
  return true;
}
