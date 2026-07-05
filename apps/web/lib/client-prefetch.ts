"use client";

/**
 * Intent-prefetch helpers — warm the browser QueryClient cache for the data a
 * navigation is *about* to need (sidebar hover → that section's list; table-row
 * hover → that item's detail). They use the exact same `queryKey` + path the
 * destination hook uses (parity via `lib/query-keys.ts`), so when the page
 * mounts its `useQuery` reads a warm, fresh cache and renders without a skeleton.
 *
 * `prefetchQuery` is a no-op when the data is already fresh (within staleTime),
 * so spamming hover is cheap. Call from `onMouseEnter`/`onFocus` handlers with
 * the client from `useQueryClient()`.
 */

import type { QueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import {
  queryKeys,
  dashboardKeys,
  eventLogsListPath,
  eventLogPath,
  eventsPath,
  dashboardsListPath,
  dashboardPath,
  modulesListPath,
  ocelListPath,
  variantsPath,
  DEFAULT_VARIANTS_SORT,
  OCEL_PAGE_SIZE,
  PROCESS_PAGE_SIZE,
} from "@/lib/query-keys";
import type {
  ActivitiesPage,
  DataQuality,
  EventLogDetail,
  EventLogSummary,
  EventsPage,
  ModuleSummary,
  OcelEventsPage,
  OcelObjectsPage,
  OcelObjectTypeEntry,
  OcelOverview,
  OcelRelationsPage,
  VariantsPage,
} from "@/lib/api-types";
import type { DashboardDetail, DashboardSummary } from "@/lib/dashboard-queries";

const STALE = 60_000;

export function prefetchEventLogs(
  qc: QueryClient,
  params: { q?: string; status?: string } = {},
): Promise<void> {
  return qc.prefetchQuery({
    queryKey: [...queryKeys.eventLogs(), params],
    queryFn: () => api<EventLogSummary[]>(eventLogsListPath(params)),
    staleTime: STALE,
  });
}

export function prefetchEventLog(qc: QueryClient, id: string): void {
  void qc.prefetchQuery({
    queryKey: queryKeys.eventLog(id),
    queryFn: () => api<EventLogDetail>(eventLogPath(id)),
    staleTime: STALE,
  });
}

export function prefetchDashboards(qc: QueryClient): Promise<void> {
  return qc.prefetchQuery({
    queryKey: dashboardKeys.all(),
    queryFn: () => api<DashboardSummary[]>(dashboardsListPath()),
    staleTime: STALE,
  });
}

export function prefetchDashboard(qc: QueryClient, id: string): void {
  void qc.prefetchQuery({
    queryKey: dashboardKeys.detail(id),
    queryFn: () => api<DashboardDetail>(dashboardPath(id)),
    staleTime: STALE,
  });
}

export function prefetchModules(qc: QueryClient): Promise<void> {
  return qc.prefetchQuery({
    queryKey: queryKeys.modules(null),
    queryFn: () => api<ModuleSummary[]>(modulesListPath(null)),
    staleTime: STALE,
  });
}

/**
 * Warm every tab of the process-detail page once the log is `ready`, so the
 * first click on Events/Variants/Activities (or the OCEL tabs) renders from
 * cache instead of a skeleton. The params mirror each tab's initial state –
 * `PROCESS_PAGE_SIZE` / `DEFAULT_VARIANTS_SORT` / `OCEL_PAGE_SIZE` are shared
 * with the tab components so the two sides can't drift. staleTimes mirror the
 * owning hooks in `lib/queries.ts`.
 */
export function prefetchProcessTabs(qc: QueryClient, log: EventLogDetail): void {
  if (log.status !== "ready") return;
  const logId = log.id;

  if (log.log_model === "object_centric") {
    const params = { offset: 0, limit: OCEL_PAGE_SIZE };
    void qc.prefetchQuery({
      queryKey: queryKeys.ocelOverview(logId),
      queryFn: () => api<OcelOverview>(`/api/v1/event-logs/${logId}/ocel/overview`),
    });
    void qc.prefetchQuery({
      queryKey: queryKeys.ocelObjectTypes(logId),
      queryFn: () => api<OcelObjectTypeEntry[]>(`/api/v1/event-logs/${logId}/ocel/object-types`),
    });
    void qc.prefetchQuery({
      queryKey: queryKeys.ocelObjects(logId, params),
      queryFn: () => api<OcelObjectsPage>(ocelListPath(logId, "objects", params)),
    });
    void qc.prefetchQuery({
      queryKey: queryKeys.ocelEvents(logId, params),
      queryFn: () => api<OcelEventsPage>(ocelListPath(logId, "events", params)),
    });
    void qc.prefetchQuery({
      queryKey: queryKeys.ocelRelationships(logId, params),
      queryFn: () => api<OcelRelationsPage>(ocelListPath(logId, "relationships", params)),
    });
    return;
  }

  // The Events tab seeds its filter editor from the applied dataset filter, so
  // its first query carries `filter` only when one is applied.
  const eventsParams = {
    offset: 0,
    limit: PROCESS_PAGE_SIZE,
    ...(log.active_filter && log.active_filter.length > 0 ? { filter: log.active_filter } : {}),
  };
  void qc.prefetchQuery({
    queryKey: queryKeys.events(logId, eventsParams),
    queryFn: () => api<EventsPage>(eventsPath(logId, eventsParams)),
    staleTime: 5_000,
  });
  const variantsParams = { offset: 0, limit: PROCESS_PAGE_SIZE, sort: DEFAULT_VARIANTS_SORT };
  void qc.prefetchQuery({
    queryKey: queryKeys.variants(logId, variantsParams),
    queryFn: () => api<VariantsPage>(variantsPath(logId, variantsParams)),
    staleTime: 30_000,
  });
  void qc.prefetchQuery({
    queryKey: queryKeys.activities(logId),
    queryFn: () => api<ActivitiesPage>(`/api/v1/event-logs/${logId}/activities`),
    staleTime: 30_000,
  });
  void qc.prefetchQuery({
    queryKey: queryKeys.dataQuality(logId),
    queryFn: () => api<DataQuality>(`/api/v1/event-logs/${logId}/data-quality`),
    staleTime: 30_000,
  });
}
