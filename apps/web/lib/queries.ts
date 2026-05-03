"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ActivitiesPage,
  BulkFillBody,
  BulkFillResult,
  CellPatch,
  CellPatchResult,
  DataQuality,
  EventEditsPage,
  EventLogCreateResponse,
  EventLogDetail,
  EventLogSummary,
  EventLogUpdatePayload,
  EventsPage,
  FilterEntry,
  JobDetail,
  ModuleSummary,
  VariantCasesPage,
  VariantDetail,
  VariantsPage,
} from "@/lib/api-types";

export interface EventsListParams {
  offset?: number;
  limit?: number;
  sort?: string;
  filter?: FilterEntry[];
  q?: string;
  missing_only?: boolean;
  case_id?: string;
}

export interface VariantsListParams {
  offset?: number;
  limit?: number;
  sort?: string;
  activity_contains?: string;
  min_case_count?: number;
}

export const queryKeys = {
  eventLogs: () => ["event-logs"] as const,
  eventLog: (id: string) => ["event-logs", id] as const,
  events: (logId: string, params: EventsListParams) =>
    ["event-logs", logId, "events", params] as const,
  variants: (logId: string, params: VariantsListParams) =>
    ["event-logs", logId, "variants", params] as const,
  variant: (logId: string, variantId: string) =>
    ["event-logs", logId, "variants", variantId] as const,
  variantCases: (logId: string, variantId: string, offset: number, limit: number) =>
    ["event-logs", logId, "variants", variantId, "cases", offset, limit] as const,
  dataQuality: (logId: string) => ["event-logs", logId, "data-quality"] as const,
  activities: (logId: string) => ["event-logs", logId, "activities"] as const,
  edits: (logId: string, offset: number, limit: number) =>
    ["event-logs", logId, "edits", offset, limit] as const,
  modules: (logId?: string | null) => ["modules", logId ?? null] as const,
  moduleManifest: (id: string) => ["modules", id, "manifest"] as const,
  moduleConfig: (id: string) => ["modules", id, "config"] as const,
  jobs: (params?: Record<string, string>) => ["jobs", params ?? {}] as const,
  job: (id: string) => ["jobs", id] as const,
};

function eventsPath(logId: string, params: EventsListParams): string {
  const qs = new URLSearchParams();
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.sort) qs.set("sort", params.sort);
  if (params.filter && params.filter.length > 0) qs.set("filter", JSON.stringify(params.filter));
  if (params.q) qs.set("q", params.q);
  if (params.missing_only) qs.set("missing_only", "true");
  if (params.case_id) qs.set("case_id", params.case_id);
  return `/api/v1/event-logs/${logId}/events${qs.toString() ? `?${qs}` : ""}`;
}

function variantsPath(logId: string, params: VariantsListParams): string {
  const qs = new URLSearchParams();
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.sort) qs.set("sort", params.sort);
  if (params.activity_contains) qs.set("activity_contains", params.activity_contains);
  if (params.min_case_count !== undefined) qs.set("min_case_count", String(params.min_case_count));
  return `/api/v1/event-logs/${logId}/variants${qs.toString() ? `?${qs}` : ""}`;
}

export function useEventLogs(params: { q?: string; status?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.status) qs.set("status", params.status);
  const path = `/api/v1/event-logs${qs.toString() ? `?${qs}` : ""}`;
  return useQuery({
    queryKey: [...queryKeys.eventLogs(), params],
    queryFn: () => api<EventLogSummary[]>(path),
  });
}

export function useEventLog(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.eventLog(id) : ["event-logs", "noop"],
    queryFn: () => api<EventLogDetail>(`/api/v1/event-logs/${id}`),
    enabled: !!id,
    refetchInterval: (q) => {
      const data = q.state.data as EventLogDetail | undefined;
      if (!data) return false;
      return data.status === "importing" ? 1000 : false;
    },
  });
}

export function useModules(logId?: string | null) {
  const qs = logId ? `?log_id=${encodeURIComponent(logId)}` : "";
  return useQuery({
    queryKey: queryKeys.modules(logId),
    queryFn: () => api<ModuleSummary[]>(`/api/v1/modules${qs}`),
  });
}

export function useImportEventLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; name?: string; csvMapping?: unknown }) => {
      const fd = new FormData();
      fd.append("file", input.file);
      if (input.name) fd.append("name", input.name);
      if (input.csvMapping) fd.append("csv_mapping", JSON.stringify(input.csvMapping));
      return api<EventLogCreateResponse>("/api/v1/event-logs", { method: "POST", body: fd });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.eventLogs() });
    },
  });
}

export function useDeleteEventLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/v1/event-logs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.eventLogs() });
    },
  });
}

export function useRenameEventLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name: string }) =>
      api<EventLogDetail>(`/api/v1/event-logs/${input.id}`, {
        method: "PATCH",
        json: { name: input.name },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.eventLogs() });
      qc.invalidateQueries({ queryKey: queryKeys.eventLog(vars.id) });
    },
  });
}

export function useUpdateEventLog(logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: EventLogUpdatePayload) =>
      api<EventLogDetail>(`/api/v1/event-logs/${logId}`, {
        method: "PATCH",
        json: payload,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.eventLogs() });
      qc.invalidateQueries({ queryKey: queryKeys.eventLog(logId) });
      // Column-override changes affect every events page; clear them.
      qc.invalidateQueries({ queryKey: ["event-logs", logId, "events"] });
    },
  });
}

export function useReimportEventLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<EventLogCreateResponse>(`/api/v1/event-logs/${id}/reimport`, {
        method: "POST",
      }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.eventLogs() });
      qc.invalidateQueries({ queryKey: queryKeys.eventLog(id) });
    },
  });
}

export function useJobsList(params: { status?: string; type?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.type) qs.set("type", params.type);
  if (params.limit) qs.set("limit", String(params.limit));
  return useQuery({
    queryKey: queryKeys.jobs(Object.fromEntries(qs)),
    queryFn: () => api<JobDetail[]>(`/api/v1/jobs${qs.toString() ? `?${qs}` : ""}`),
  });
}

export function useJob(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.job(id) : ["jobs", "noop"],
    queryFn: () => api<JobDetail>(`/api/v1/jobs/${id}`),
    enabled: !!id,
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/v1/jobs/${id}/cancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ job_id: string }>(`/api/v1/jobs/${id}/retry`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useModuleConfig(moduleId: string) {
  return useQuery({
    queryKey: queryKeys.moduleConfig(moduleId),
    queryFn: () =>
      api<{ config: Record<string, unknown>; enabled: boolean }>(
        `/api/v1/modules/${moduleId}/config`,
      ),
  });
}

export function useInstallModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file?: File; gitUrl?: string; ref?: string }) => {
      const fd = new FormData();
      if (input.file) fd.append("file", input.file);
      if (input.gitUrl) fd.append("git_url", input.gitUrl);
      if (input.ref) fd.append("ref", input.ref);
      return api<{ job_id: string }>("/api/v1/modules/install", {
        method: "POST",
        body: fd,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modules"] });
    },
  });
}

export function useUninstallModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/v1/modules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["modules"] }),
  });
}

export function useUpdateModuleConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; config: Record<string, unknown>; enabled: boolean }) =>
      api(`/api/v1/modules/${input.id}/config`, {
        method: "PUT",
        json: { config: input.config, enabled: input.enabled },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.moduleConfig(vars.id) });
    },
  });
}

// ── Events / Variants / Quality / Edits ─────────────────────────────────────

export function useEventLogRows(logId: string, params: EventsListParams) {
  return useQuery({
    queryKey: queryKeys.events(logId, params),
    queryFn: () => api<EventsPage>(eventsPath(logId, params)),
    enabled: !!logId,
    placeholderData: (prev) => prev,
    staleTime: 5_000,
  });
}

export function usePatchEventRow(logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { rowIndex: number; patch: CellPatch }) =>
      api<CellPatchResult>(`/api/v1/event-logs/${logId}/events/${input.rowIndex}`, {
        method: "PATCH",
        json: input.patch,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event-logs", logId, "events"] });
      qc.invalidateQueries({ queryKey: queryKeys.eventLog(logId) });
      qc.invalidateQueries({ queryKey: queryKeys.eventLogs() });
      // Variants and data-quality both depend on the parquet too.
      qc.invalidateQueries({ queryKey: ["event-logs", logId, "variants"] });
      qc.invalidateQueries({ queryKey: queryKeys.dataQuality(logId) });
      qc.invalidateQueries({ queryKey: ["event-logs", logId, "edits"] });
    },
  });
}

export function useBulkFillEventRows(logId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkFillBody) =>
      api<BulkFillResult>(`/api/v1/event-logs/${logId}/events/bulk-fill`, {
        method: "POST",
        json: body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["event-logs", logId, "events"] });
      qc.invalidateQueries({ queryKey: queryKeys.eventLog(logId) });
      qc.invalidateQueries({ queryKey: ["event-logs", logId, "variants"] });
      qc.invalidateQueries({ queryKey: queryKeys.dataQuality(logId) });
      qc.invalidateQueries({ queryKey: ["event-logs", logId, "edits"] });
    },
  });
}

export function useVariants(logId: string, params: VariantsListParams) {
  return useQuery({
    queryKey: queryKeys.variants(logId, params),
    queryFn: () => api<VariantsPage>(variantsPath(logId, params)),
    enabled: !!logId,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useVariant(logId: string, variantId: string | null) {
  return useQuery({
    queryKey: variantId
      ? queryKeys.variant(logId, variantId)
      : ["event-logs", logId, "variants", "noop"],
    queryFn: () =>
      api<VariantDetail>(`/api/v1/event-logs/${logId}/variants/${variantId}`),
    enabled: !!logId && !!variantId,
    staleTime: 30_000,
  });
}

export function useVariantCases(
  logId: string,
  variantId: string | null,
  offset = 0,
  limit = 100,
) {
  return useQuery({
    queryKey: variantId
      ? queryKeys.variantCases(logId, variantId, offset, limit)
      : ["event-logs", logId, "variants", "noop", "cases"],
    queryFn: () =>
      api<VariantCasesPage>(
        `/api/v1/event-logs/${logId}/variants/${variantId}/cases?offset=${offset}&limit=${limit}`,
      ),
    enabled: !!logId && !!variantId,
    staleTime: 30_000,
  });
}

export function useDataQuality(logId: string) {
  return useQuery({
    queryKey: queryKeys.dataQuality(logId),
    queryFn: () => api<DataQuality>(`/api/v1/event-logs/${logId}/data-quality`),
    enabled: !!logId,
    staleTime: 30_000,
  });
}

export function useActivities(logId: string) {
  return useQuery({
    queryKey: queryKeys.activities(logId),
    queryFn: () => api<ActivitiesPage>(`/api/v1/event-logs/${logId}/activities`),
    enabled: !!logId,
    staleTime: 30_000,
  });
}

export function useEventEdits(logId: string, offset = 0, limit = 50) {
  return useQuery({
    queryKey: queryKeys.edits(logId, offset, limit),
    queryFn: () =>
      api<EventEditsPage>(
        `/api/v1/event-logs/${logId}/edits?offset=${offset}&limit=${limit}`,
      ),
    enabled: !!logId,
    staleTime: 10_000,
  });
}
