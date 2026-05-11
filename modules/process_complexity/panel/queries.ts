"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

const STALE_TIME = 30_000;

function url(path: string, logId: string, params?: Record<string, string>): string {
  const q = new URLSearchParams({ log_id: logId, ...params });
  return `/api/v1/modules/process_complexity${path}?${q}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Flat metric bag returned by GET /metrics */
export interface ComplexityMetrics {
  // EPA entropy
  variant_entropy: number;
  normalized_variant_entropy: number;
  sequence_entropy: number;
  normalized_sequence_entropy: number;
  sequence_entropy_linear: number;
  sequence_entropy_linear_norm: number;
  sequence_entropy_exponential: number;
  sequence_entropy_exponential_norm: number;
  // Structural
  lempel_ziv: number;
  affinity: number;
  structure: number;
  deviation_from_random: number | null;
  // Pentland
  pentland_task: number;
  pentland_process: number;
  // Log characteristics
  magnitude: number;
  variety: number;
  support: number;
  level_of_detail: number;
  pct_distinct_traces: number;
  time_granularity_s: number;
  log_duration_s: number;
  // Trace lengths
  mean_trace_length: number;
  median_trace_length: number;
  std_trace_length: number;
  min_trace_length: number;
  max_trace_length: number;
}

export interface ComplexityMetricsPayload {
  kind: "complexity_metrics";
  metrics: ComplexityMetrics;
}

export interface TemporalWindow {
  label: string;
  start: string;
  end: string;
  metrics: ComplexityMetrics;
}

export interface ComplexityTemporalPayload {
  kind: "complexity_temporal";
  window: string;
  windows: TemporalWindow[];
}

export interface ComplexityCorrelationsPayload {
  kind: "complexity_correlations";
  metrics: string[];
  matrix: number[][];
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useComplexityMetrics(logId: string) {
  return useQuery<ComplexityMetricsPayload>({
    queryKey: ["modules", "process_complexity", "metrics", logId],
    queryFn: () => api<ComplexityMetricsPayload>(url("/metrics", logId)),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useComplexityTemporal(logId: string, window: string = "week") {
  return useQuery<ComplexityTemporalPayload>({
    queryKey: ["modules", "process_complexity", "temporal", logId, window],
    queryFn: () => api<ComplexityTemporalPayload>(url("/temporal", logId, { window })),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useComplexityCorrelations(logId: string, window: string = "week") {
  return useQuery<ComplexityCorrelationsPayload>({
    queryKey: ["modules", "process_complexity", "correlations", logId, window],
    queryFn: () =>
      api<ComplexityCorrelationsPayload>(url("/correlations", logId, { window })),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}
