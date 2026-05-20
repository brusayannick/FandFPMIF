"use client";

import {
  Activity,
  BarChart2,
  Braces,
  Clock,
  GitFork,
  Hash,
  Info,
  Layers,
  Network,
  Sigma,
  Timer,
  TrendingUp,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatDuration, formatNumber } from "@/lib/format";

import { useComplexityMetrics, type ComplexityMetrics } from "./queries";

export function ComplexityPanel({ logId }: { logId: string; moduleId: string }) {
  const q = useComplexityMetrics(logId);

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <KpiGridSkeleton />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Could not load complexity metrics. Re-import the log or check the
          module's logs.
        </CardContent>
      </Card>
    );
  }

  const { basic, enriched, enriched_supported } = q.data;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Complexity</h2>
          <p className="text-xs text-muted-foreground">
            Variant / sequence entropy, Pentland and structural measures
            built on the Extended Prefix Automaton. After Rüschel &amp; Langer.
          </p>
        </div>
        {enriched_supported ? (
          <Badge variant="secondary" className="gap-1.5">
            <Info className="h-3 w-3" />
            Enriched attribute set detected
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1.5 text-muted-foreground">
            <Info className="h-3 w-3" />
            Basic only (XES standard attributes missing)
          </Badge>
        )}
      </header>

      {enriched && enriched_supported ? (
        <Tabs defaultValue="basic">
          <TabsList>
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="enriched">Enriched EPA</TabsTrigger>
          </TabsList>
          <TabsContent value="basic" className="mt-4">
            <MetricsView metrics={basic} />
          </TabsContent>
          <TabsContent value="enriched" className="mt-4">
            <MetricsView metrics={enriched} />
          </TabsContent>
        </Tabs>
      ) : (
        <MetricsView metrics={basic} />
      )}
    </div>
  );
}

// ── Metrics view ─────────────────────────────────────────────────────────────

function MetricsView({ metrics }: { metrics: ComplexityMetrics }) {
  return (
    <div className="space-y-4">
      <HighlightGrid metrics={metrics} />
      <EntropyTable metrics={metrics} />
      <StructuralTable metrics={metrics} />
    </div>
  );
}

function HighlightGrid({ metrics }: { metrics: ComplexityMetrics }) {
  const cards: { icon: LucideIcon; title: string; value: string; subline?: string }[] = [
    {
      icon: Hash,
      title: "Magnitude",
      value: formatNumber(metrics.magnitude),
      subline: "Total events",
    },
    {
      icon: Layers,
      title: "Support",
      value: formatNumber(metrics.support),
      subline: "Cases",
    },
    {
      icon: GitFork,
      title: "Variety",
      value: formatNumber(metrics.variety),
      subline: "Distinct activities",
    },
    {
      icon: BarChart2,
      title: "Level of detail",
      value: fmt(metrics.level_of_detail, 2),
      subline: "Avg distinct activities per case",
    },
    {
      icon: Timer,
      title: "Time granularity",
      value: formatDuration(metrics.time_granularity_s),
      subline: "Mean per-case min inter-event gap",
    },
    {
      icon: Network,
      title: "Structure",
      value: fmt(metrics.structure, 3),
      subline: "1 − |DF edges| / variety²",
    },
    {
      icon: Workflow,
      title: "Affinity",
      value: fmt(metrics.affinity, 3),
      subline: "Weighted Jaccard on DF patterns",
    },
    {
      icon: Activity,
      title: "Distinct traces",
      value: `${fmt(metrics.distinct_traces_pct, 1)}%`,
      subline: "Unique variants / cases",
    },
    {
      icon: Clock,
      title: "Trace length",
      value: `${fmt(metrics.trace_length_min, 0)} / ${fmt(
        metrics.trace_length_avg,
        1,
      )} / ${fmt(metrics.trace_length_max, 0)}`,
      subline: "min / avg / max",
    },
    {
      icon: TrendingUp,
      title: "Deviation from random",
      value: fmt(metrics.deviation_from_random, 3),
      subline: "1 − ‖transition – uniform‖",
    },
    {
      icon: Braces,
      title: "Lempel-Ziv",
      value: formatNumber(metrics.lempel_ziv),
      subline: "LZ76 phrases (time-ordered)",
    },
    {
      icon: Sigma,
      title: "Pentland process",
      value: fmt(metrics.pentland_process, 2),
      subline: `Task complexity ${formatNumber(metrics.pentland_task)}`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {cards.map((c) => (
        <KpiCard key={c.title} {...c} />
      ))}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  title,
  value,
  subline,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  subline?: string;
}) {
  return (
    <Card>
      <CardContent className="p-[var(--card-padding,1rem)]">
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span className="text-[10px] uppercase tracking-wide">{title}</span>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
        {subline ? (
          <div className="mt-1 text-[11px] text-muted-foreground">{subline}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Detailed tables ──────────────────────────────────────────────────────────

function EntropyTable({ metrics }: { metrics: ComplexityMetrics }) {
  const k = metrics.exponential_k;
  const rows: { label: string; raw: number | null; norm: number | null }[] = [
    {
      label: "Variant entropy",
      raw: metrics.variant_entropy,
      norm: metrics.normalized_variant_entropy,
    },
    {
      label: "Sequence entropy",
      raw: metrics.sequence_entropy,
      norm: metrics.normalized_sequence_entropy,
    },
    {
      label: "Sequence entropy (linear forgetting)",
      raw: metrics.sequence_entropy_linear,
      norm: metrics.normalized_sequence_entropy_linear,
    },
    {
      label: `Sequence entropy (exponential forgetting, k=${formatK(k)})`,
      raw: metrics.sequence_entropy_exponential,
      norm: metrics.normalized_sequence_entropy_exponential,
    },
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Entropy measures</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-4 font-medium">Measure</th>
                <th className="py-1.5 pr-4 font-medium tabular-nums">Value</th>
                <th className="py-1.5 font-medium tabular-nums">Normalised</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-border/60">
                  <td className="py-1.5 pr-4">{r.label}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{fmt(r.raw, 3)}</td>
                  <td className="py-1.5 tabular-nums">{fmt(r.norm, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function StructuralTable({ metrics }: { metrics: ComplexityMetrics }) {
  const rows: { label: string; value: string }[] = [
    { label: "Magnitude", value: formatNumber(metrics.magnitude) },
    { label: "Support", value: formatNumber(metrics.support) },
    { label: "Variety", value: formatNumber(metrics.variety) },
    { label: "Level of detail", value: fmt(metrics.level_of_detail, 3) },
    {
      label: "Time granularity",
      value: formatDuration(metrics.time_granularity_s),
    },
    { label: "Structure", value: fmt(metrics.structure, 3) },
    { label: "Affinity", value: fmt(metrics.affinity, 3) },
    {
      label: "Trace length",
      value: `${fmt(metrics.trace_length_min, 0)} / ${fmt(
        metrics.trace_length_avg,
        2,
      )} / ${fmt(metrics.trace_length_max, 0)}`,
    },
    {
      label: "Distinct traces",
      value: `${fmt(metrics.distinct_traces_pct, 2)} %`,
    },
    {
      label: "Deviation from random",
      value: fmt(metrics.deviation_from_random, 3),
    },
    { label: "Lempel-Ziv complexity", value: formatNumber(metrics.lempel_ziv) },
    {
      label: "Pentland's task complexity",
      value: formatNumber(metrics.pentland_task),
    },
    {
      label: "Pentland's process complexity",
      value: fmt(metrics.pentland_process, 3),
    },
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold">Selected measures</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-border/60">
                  <td className="py-1.5 pr-4 text-muted-foreground">{r.label}</td>
                  <td className="py-1.5 tabular-nums">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmt(v: number | null | undefined, d: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

function formatK(k: number | undefined): string {
  if (k === undefined || k === null || Number.isNaN(k)) return "1";
  return Number.isInteger(k) ? k.toString() : k.toFixed(2);
}

function KpiGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}
