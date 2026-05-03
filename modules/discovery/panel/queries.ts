"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { DfgData, PetriNetData, ProcessTreeData } from "@/components/visualizations";

const STALE_TIME = 30_000;

function discoveryUrl(path: string, logId: string, params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams({ log_id: logId });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }
  return `/api/v1/modules/discovery${path}?${search.toString()}`;
}

export function useDiscoveryDfg(logId: string) {
  return useQuery<DfgData>({
    queryKey: ["modules", "discovery", "dfg", logId],
    queryFn: () => api<DfgData>(discoveryUrl("/dfg", logId)),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useDiscoveryPetriAlpha(logId: string) {
  return useQuery<PetriNetData>({
    queryKey: ["modules", "discovery", "petri-alpha", logId],
    queryFn: () => api<PetriNetData>(discoveryUrl("/petri-net/alpha", logId)),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useDiscoveryPetriInductive(logId: string) {
  return useQuery<PetriNetData>({
    queryKey: ["modules", "discovery", "petri-inductive", logId],
    queryFn: () => api<PetriNetData>(discoveryUrl("/petri-net/inductive", logId)),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useDiscoveryProcessTree(logId: string) {
  return useQuery<ProcessTreeData>({
    queryKey: ["modules", "discovery", "process-tree", logId],
    queryFn: () => api<ProcessTreeData>(discoveryUrl("/process-tree", logId)),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export interface HeuristicsThresholds {
  dependency_threshold?: number;
  and_threshold?: number;
  loop_two_threshold?: number;
}

export function useDiscoveryHeuristicsNet(logId: string, thresholds: HeuristicsThresholds = {}) {
  return useQuery<DfgData>({
    queryKey: ["modules", "discovery", "heuristics-net", logId, thresholds],
    queryFn: () =>
      api<DfgData>(
        discoveryUrl("/heuristics-net", logId, {
          dependency_threshold: thresholds.dependency_threshold,
          and_threshold: thresholds.and_threshold,
          loop_two_threshold: thresholds.loop_two_threshold,
        }),
      ),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}
