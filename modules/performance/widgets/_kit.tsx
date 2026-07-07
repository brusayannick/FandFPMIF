"use client";

/**
 * Tiny presentation kit shared by the performance module's dashboard cards.
 * Each card is bundled independently (`apps/web/scripts/bundle-modules.mjs`),
 * so this file is inlined into every widget bundle – keep it small and
 * dependency-light (only runtime externals: ui/skeleton, ui/tooltip via
 * InfoHint, lib/format).
 */
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { InfoHint } from "../panel/info-hint";

export function CardShell({
  loading,
  empty,
  emptyText = "No data for this log yet.",
  children,
}: {
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
}) {
  if (loading) return <Skeleton className="h-full min-h-24 w-full" />;
  if (empty)
    return (
      <div className="flex h-full min-h-24 items-center justify-center text-center text-xs text-muted-foreground">
        {emptyText}
      </div>
    );
  return <div className="h-full">{children}</div>;
}

export function KpiTile({
  label,
  value,
  hint,
  info,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Plain-language explanation shown behind a small ⓘ button next to the label. */
  info?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="truncate text-[11px] uppercase tracking-wide">{label}</span>
        {info && <InfoHint label={`What does ${label} mean?`}>{info}</InfoHint>}
      </div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums tracking-tight">
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}
