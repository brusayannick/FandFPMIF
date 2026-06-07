"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

const STALE_TIME = 30_000;

export interface ObjectTypeCount {
  type: string;
  count: number;
}

export interface OcelSummary {
  object_types: ObjectTypeCount[];
  objects_count: number;
  events_count: number;
  activities_count: number;
}

export interface OcdfgEdge {
  object_type: string;
  source: string;
  target: string;
  count: number;
}

export interface OcdfgActivity {
  object_type: string;
  activity: string;
  count: number;
}

export interface OcdfgData {
  activities: string[];
  object_types: string[];
  edges: OcdfgEdge[];
  start_activities: OcdfgActivity[];
  end_activities: OcdfgActivity[];
}

function url(path: string, logId: string): string {
  return `/api/v1/modules/ocel_discovery${path}?log_id=${encodeURIComponent(logId)}`;
}

export function useOcelSummary(logId: string) {
  return useQuery<OcelSummary>({
    queryKey: ["modules", "ocel_discovery", "summary", logId],
    queryFn: () => api<OcelSummary>(url("/summary", logId)),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}

export function useOcdfg(logId: string) {
  return useQuery<OcdfgData>({
    queryKey: ["modules", "ocel_discovery", "ocdfg", logId],
    queryFn: () => api<OcdfgData>(url("/ocdfg", logId)),
    enabled: Boolean(logId),
    staleTime: STALE_TIME,
  });
}
