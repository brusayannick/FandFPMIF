"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { LogModel } from "@/lib/api-types";
import type { DatasetEnvelope } from "@/lib/visualizations/types";

/**
 * Data layer for the node-graph builder (/api/v1/flows). A flow is a graph of
 * source/module/transform/viz nodes bound to one event log; `GET
 * /flows/{id}/nodes/{nodeId}/data` executes a node (resolving its upstream) and
 * returns a `DatasetEnvelope` the generic-viz components render. Mirrors
 * `apps/api/.../schemas/flows.py`.
 */

export type FlowNodeType = "source" | "module" | "transform" | "viz";

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowSummary {
  id: string;
  name: string;
  description: string | null;
  event_log_id: string | null;
  log_model: LogModel;
  node_count: number;
  updated_at: string;
}

export interface FlowDetail {
  id: string;
  name: string;
  description: string | null;
  event_log_id: string | null;
  log_model: LogModel;
  graph: FlowGraph;
  created_at: string;
  updated_at: string;
  is_owner: boolean;
}

export interface FlowPatch {
  name?: string;
  description?: string | null;
  event_log_id?: string | null;
  graph?: FlowGraph;
}

export const flowKeys = {
  all: () => ["flows"] as const,
  detail: (id: string) => ["flows", id] as const,
  nodeData: (flowId: string, nodeId: string) => ["flows", flowId, "node", nodeId] as const,
};

export function useFlows() {
  return useQuery({
    queryKey: flowKeys.all(),
    queryFn: () => api<FlowSummary[]>("/api/v1/flows"),
  });
}

export function useFlow(id: string | null) {
  return useQuery({
    queryKey: id ? flowKeys.detail(id) : ["flows", "noop"],
    queryFn: () => api<FlowDetail>(`/api/v1/flows/${id}`),
    enabled: !!id,
  });
}

export function useCreateFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; event_log_id?: string | null; log_model: LogModel }) =>
      api<FlowDetail>("/api/v1/flows", { method: "POST", json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: flowKeys.all() });
    },
  });
}

export function useUpdateFlow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: FlowPatch) =>
      api<FlowDetail>(`/api/v1/flows/${id}`, { method: "PATCH", json: patch }),
    onSuccess: (data) => {
      qc.setQueryData(flowKeys.detail(id), data);
    },
  });
}

export function useDeleteFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/v1/flows/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: flowKeys.all() });
    },
  });
}

export interface FlowShareOut {
  id: string;
  flow_id: string;
  kind: "user" | "team";
  target_id: string;
  label: string;
  created_at: string;
}

export function useFlowShares(flowId: string | null) {
  return useQuery({
    queryKey: ["flows", flowId, "shares"],
    queryFn: () => api<FlowShareOut[]>(`/api/v1/flows/${flowId}/shares`),
    enabled: !!flowId,
  });
}

export function useAddFlowShare(flowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { target_user_id?: string; target_team_id?: string }) =>
      api<FlowShareOut>(`/api/v1/flows/${flowId}/shares`, { method: "POST", json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["flows", flowId, "shares"] }),
  });
}

export function useRemoveFlowShare(flowId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) =>
      api<void>(`/api/v1/flows/${flowId}/shares/${shareId}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["flows", flowId, "shares"] }),
  });
}

/** Execute one node and fetch its envelope. `version` busts the cache after a
 * graph save so a node's preview reflects its latest config. */
export function useFlowNodeData(
  flowId: string,
  nodeId: string,
  opts: { enabled?: boolean; version?: number } = {},
) {
  return useQuery({
    queryKey: [...flowKeys.nodeData(flowId, nodeId), opts.version ?? 0],
    queryFn: () => api<DatasetEnvelope>(`/api/v1/flows/${flowId}/nodes/${nodeId}/data`),
    enabled: opts.enabled ?? true,
    retry: false,
    staleTime: 10_000,
  });
}
