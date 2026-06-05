"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { ColumnSpec, EventsPage } from "@/lib/api-types";

/**
 * Dashboards data layer.
 *
 * A dashboard is a grid of cards (each a module's `(module_id, widget_id)`)
 * bound to one event log. The card catalog (`useCardCatalog`) is aggregated by
 * the backend from every installed module's `frontend.widgets`; the palette
 * renders it and `useWidget(module_id, widget_id)` (lib/module-widgets) lazily
 * loads the actual bundle when a card mounts.
 *
 * Types mirror `apps/api/.../schemas/dashboards.py` + the `DashboardCard`
 * model in `routes/modules.py`.
 */

export interface DashboardItem {
  i: string;
  module_id: string;
  widget_id: string;
  title?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

export interface DashboardSummary {
  id: string;
  name: string;
  description: string | null;
  event_log_id: string | null;
  card_count: number;
  updated_at: string;
}

export interface DashboardDetail {
  id: string;
  name: string;
  description: string | null;
  event_log_id: string | null;
  items: DashboardItem[];
  created_at: string;
  updated_at: string;
}

/** One configurable field on a card, in the module `config_schema` dialect. */
export interface WidgetPropSchema {
  type?: "number" | "integer" | "string" | "boolean";
  title?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  step?: number;
  enum?: string[];
  /** Optional display labels parallel to `enum` (falls back to the value). */
  enumLabels?: string[];
  ui?: { widget?: string };
}

export interface WidgetConfigSchema {
  properties?: Record<string, WidgetPropSchema>;
}

export interface DashboardCard {
  module_id: string;
  module_name: string;
  widget_id: string;
  title: string;
  description: string | null;
  icon: string | null;
  default_w: number;
  default_h: number;
  config_schema: WidgetConfigSchema | null;
}

/** Seed a placement's `config` from its schema defaults when a card is added. */
export function configDefaults(schema: WidgetConfigSchema | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema?.properties ?? {})) {
    if (prop.default !== undefined) out[key] = prop.default;
  }
  return out;
}

export interface DashboardExport {
  kind: string;
  version: number;
  name: string;
  description: string | null;
  items: DashboardItem[];
}

export const dashboardKeys = {
  all: () => ["dashboards"] as const,
  detail: (id: string) => ["dashboards", id] as const,
  cards: () => ["dashboard-cards"] as const,
};

export function useDashboards() {
  return useQuery({
    queryKey: dashboardKeys.all(),
    queryFn: () => api<DashboardSummary[]>("/api/v1/dashboards"),
  });
}

export function useDashboard(id: string | null) {
  return useQuery({
    queryKey: id ? dashboardKeys.detail(id) : ["dashboards", "noop"],
    queryFn: () => api<DashboardDetail>(`/api/v1/dashboards/${id}`),
    enabled: !!id,
  });
}

/** Every card exposed by the modules the user owns — powers the palette. */
export function useCardCatalog() {
  return useQuery({
    queryKey: dashboardKeys.cards(),
    queryFn: () => api<DashboardCard[]>("/api/v1/modules/cards"),
    staleTime: 60_000,
  });
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string | null }) =>
      api<DashboardDetail>("/api/v1/dashboards", { method: "POST", json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardKeys.all() });
    },
  });
}

export interface DashboardPatch {
  name?: string;
  description?: string | null;
  event_log_id?: string | null;
  items?: DashboardItem[];
}

export function useUpdateDashboard(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: DashboardPatch) =>
      api<DashboardDetail>(`/api/v1/dashboards/${id}`, { method: "PATCH", json: patch }),
    onSuccess: (data) => {
      qc.setQueryData(dashboardKeys.detail(id), data);
      void qc.invalidateQueries({ queryKey: dashboardKeys.all() });
    },
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/v1/dashboards/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardKeys.all() });
    },
  });
}

/** Earliest/latest timestamp in a log — seeds the time-range slider. */
export interface TimeBounds {
  field: string | null;
  min_ts: string | null;
  max_ts: string | null;
}

export function useTimeBounds(logId: string | null) {
  return useQuery({
    queryKey: ["event-log-time-bounds", logId],
    queryFn: () => api<TimeBounds>(`/api/v1/event-logs/${logId}/time-bounds`),
    enabled: !!logId,
    staleTime: 5 * 60_000,
  });
}

/** Column specs for a log — backs the dashboard's global filter bar. Reuses
 * the events endpoint (one row) since it returns the inferred `columns`. */
export function useEventColumns(logId: string | null) {
  return useQuery({
    queryKey: ["event-log-columns", logId],
    queryFn: async () => {
      const page = await api<EventsPage>(`/api/v1/event-logs/${logId}/events?limit=1`);
      return page.columns.filter((c) => !c.name.startsWith("_"));
    },
    enabled: !!logId,
    staleTime: 5 * 60_000,
  });
}

export type { ColumnSpec };

export function useImportDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (doc: { name?: string; description?: string | null; items: DashboardItem[] }) =>
      api<DashboardDetail>("/api/v1/dashboards/import", { method: "POST", json: doc }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashboardKeys.all() });
    },
  });
}
