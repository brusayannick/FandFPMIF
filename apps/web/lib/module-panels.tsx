"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export interface ModulePanelProps {
  logId: string;
  moduleId: string;
}

/**
 * Maps a manifest `id` to a frontend panel component. Modules without an
 * entry render the dashed placeholder on the [moduleId] page.
 *
 * The dynamic loader described in INSTRUCTIONS.md §5.4 is not built yet — it
 * will replace this static registry with runtime imports from the per-module
 * `.dist/` bundle. Until then, this list is the explicit registry, kept tiny
 * by import-on-demand so each module's bundle ships only when its page opens.
 */
const PANELS: Record<string, ComponentType<ModulePanelProps>> = {
  discovery: dynamic(
    () => import("@modules/discovery/panel").then((m) => m.DiscoveryPanel),
    { ssr: false, loading: () => <PanelSkeleton /> },
  ),
  performance: dynamic(
    () => import("@modules/performance/panel").then((m) => m.PerformancePanel),
    { ssr: false, loading: () => <PanelSkeleton /> },
  ),
};

export function getModulePanel(moduleId: string): ComponentType<ModulePanelProps> | null {
  return PANELS[moduleId] ?? null;
}

function PanelSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
