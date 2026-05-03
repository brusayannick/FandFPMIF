"use client";

import type { VariantDetail } from "@/lib/api-types";
import { formatDuration, formatNumber, formatRelative } from "@/lib/format";

export function VariantHeader({ variant }: { variant: VariantDetail }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4 lg:grid-cols-6">
      <Stat label="Cases" value={formatNumber(variant.case_count)} />
      <Stat label="Share" value={`${(variant.case_pct * 100).toFixed(1)}%`} />
      <Stat label="Avg duration" value={formatDuration(variant.avg_duration_seconds)} />
      <Stat label="Median" value={formatDuration(variant.median_duration_seconds)} />
      <Stat label="P90" value={formatDuration(variant.p90_duration_seconds)} />
      <Stat label="Last seen" value={formatRelative(variant.last_seen)} />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
