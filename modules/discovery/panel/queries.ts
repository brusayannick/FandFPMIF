"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiUrl } from "@/lib/api";
import type {
  BpmnData,
  DfgData,
  PetriNetData,
  PrefixTreeData,
  ProcessTreeData,
} from "./types";

const STALE_TIME = 30_000;

function discoveryUrl(path: string, logId: string, params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams({ log_id: logId });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }
  return `/api/v1/modules/discovery${path}?${search.toString()}`;
}

export function useDiscoveryDfg(logId: string, variantPct?: number) {
  return useQuery<DfgData>({
    queryKey: ["modules", "discovery", "dfg", logId, variantPct ?? 1],
    queryFn: () =>
      api<DfgData>(
        discoveryUrl("/dfg", logId, variantPct !== undefined && variantPct < 1 ? { variant_pct: variantPct } : {}),
      ),
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

export function useDiscoveryPetriAlphaPlus(logId: string) {
  return useQuery<PetriNetData>({
    queryKey: ["modules", "discovery", "petri-alpha-plus", logId],
    queryFn: () => api<PetriNetData>(discoveryUrl("/petri-net/alpha-plus", logId)),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useDiscoveryPetriIlp(logId: string) {
  return useQuery<PetriNetData>({
    queryKey: ["modules", "discovery", "petri-ilp", logId],
    queryFn: () => api<PetriNetData>(discoveryUrl("/petri-net/ilp", logId)),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useDiscoveryPetriImf(logId: string, noiseThreshold: number) {
  return useQuery<PetriNetData>({
    queryKey: ["modules", "discovery", "petri-imf", logId, noiseThreshold],
    queryFn: () =>
      api<PetriNetData>(discoveryUrl("/petri-net/imf", logId, { noise_threshold: noiseThreshold })),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useDiscoveryProcessTreeImf(logId: string, noiseThreshold: number) {
  return useQuery<ProcessTreeData>({
    queryKey: ["modules", "discovery", "process-tree-imf", logId, noiseThreshold],
    queryFn: () =>
      api<ProcessTreeData>(discoveryUrl("/process-tree/imf", logId, { noise_threshold: noiseThreshold })),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useDiscoveryPrefixTree(logId: string) {
  return useQuery<PrefixTreeData>({
    queryKey: ["modules", "discovery", "prefix-tree", logId],
    queryFn: () => api<PrefixTreeData>(discoveryUrl("/prefix-tree", logId)),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export type BpmnAlgo = "inductive" | "imf";

function bpmnQueryKey(logId: string, algo: BpmnAlgo, noiseThreshold: number) {
  return ["modules", "discovery", "bpmn", logId, algo, noiseThreshold] as const;
}

export function useDiscoveryBpmn(
  logId: string,
  algo: BpmnAlgo = "inductive",
  noiseThreshold = 0.2,
) {
  return useQuery<BpmnData>({
    queryKey: bpmnQueryKey(logId, algo, noiseThreshold),
    queryFn: () =>
      api<BpmnData>(
        discoveryUrl(
          "/bpmn",
          logId,
          algo === "imf" ? { algo, noise_threshold: noiseThreshold } : { algo },
        ),
      ),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useUploadBpmn(logId: string) {
  const qc = useQueryClient();
  return useMutation<BpmnData, Error, File>({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api<BpmnData>(discoveryUrl("/bpmn/upload", logId), {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["modules", "discovery", "bpmn", logId],
      });
    },
  });
}

export function useSaveBpmn(logId: string) {
  const qc = useQueryClient();
  return useMutation<BpmnData, Error, string>({
    mutationFn: (xml: string) =>
      api<BpmnData>(discoveryUrl("/bpmn", logId), {
        method: "PUT",
        json: { xml },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["modules", "discovery", "bpmn", logId],
      });
    },
  });
}

export function useResetBpmn(logId: string) {
  const qc = useQueryClient();
  return useMutation<{ status: string }, Error, void>({
    mutationFn: () =>
      api<{ status: string }>(discoveryUrl("/bpmn", logId), { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ["modules", "discovery", "bpmn", logId],
      });
    },
  });
}

export function bpmnDownloadUrl(logId: string): string {
  return apiUrl(discoveryUrl("/bpmn/download", logId));
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
