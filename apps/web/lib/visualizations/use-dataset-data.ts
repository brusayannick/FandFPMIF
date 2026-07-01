"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useDatasetCatalog, type DashboardItem } from "@/lib/dashboard-queries";
import { normalize } from "@/lib/visualizations/adapters";
import type { DatasetEnvelope, DatasetShape } from "@/lib/visualizations/types";

export interface DatasetDataResult {
  envelope?: DatasetEnvelope;
  shape?: DatasetShape;
  isLoading: boolean;
  isError: boolean;
  /** The item's dataset_ref points at a module/dataset not in the catalog
   * (module uninstalled or dataset removed). */
  missing: boolean;
}

/**
 * Fetch + normalize a viz card's dataset. The catalog supplies the module
 * `route` + `shape` (so the placement only stores the `dataset_ref`); the data
 * is fetched straight from the module route via `api()`, which auto-attaches
 * the ambient `X-FF-Event-Filter` header. Runs inside the dashboard's widget
 * QueryClient (the card mounts within `DashboardWidgetScope`), so a filter
 * commit resets + refetches it exactly like a module widget. React-query dedups
 * the fetch so the card body and its settings form share one request.
 */
export function useDatasetData(item: DashboardItem, logId: string | null): DatasetDataResult {
  const ref = item.dataset_ref ?? null;
  const { data: catalog } = useDatasetCatalog();
  const entry = catalog?.find(
    (e) => e.module_id === ref?.module_id && e.dataset_id === ref?.dataset_id,
  );
  const route = entry?.route;
  const shape = entry?.shape as DatasetShape | undefined;
  const enabled = Boolean(ref && route && logId);

  const q = useQuery({
    queryKey: ["dataset-data", ref?.module_id, ref?.dataset_id, logId],
    queryFn: () => api<unknown>(`/api/v1/modules/${ref!.module_id}${route}?log_id=${logId}`),
    enabled,
    staleTime: 30_000,
  });

  const envelope = useMemo(
    () => (q.data !== undefined && shape ? normalize(shape, q.data) : undefined),
    [q.data, shape],
  );

  return {
    envelope,
    shape,
    isLoading: enabled && q.isLoading,
    isError: q.isError,
    missing: Boolean(catalog && ref && !entry),
  };
}
