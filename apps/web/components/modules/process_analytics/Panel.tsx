"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BarChart3, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";
import { formatDuration } from "@/lib/utils";
import type { ModulePanelProps } from "@/components/modules/types";
import { z } from "zod";

const nodeMetricSchema = z.object({
  node_id: z.string(),
  label: z.string(),
  type: z.string(),
  avg_duration_ms: z.number(),
  p90_duration_ms: z.number(),
  throughput: z.number(),
  utilization: z.number(),
  severity: z.number(),
  is_bottleneck: z.boolean(),
});

const histogramBinSchema = z.object({
  lower_ms: z.number(),
  upper_ms: z.number(),
  count: z.number().int(),
});

const analyticsResultSchema = z.object({
  generated_at: z.string(),
  process_id: z.string().nullable(),
  node_count: z.number().int(),
  edge_count: z.number().int(),
  avg_cycle_time_ms: z.number(),
  p50_cycle_time_ms: z.number(),
  p90_cycle_time_ms: z.number(),
  critical_bottlenecks: z.array(nodeMetricSchema),
  node_metrics: z.array(nodeMetricSchema),
  cycle_time_histogram: z.array(histogramBinSchema),
});

type AnalyticsResult = z.infer<typeof analyticsResultSchema>;

export function ProcessAnalyticsPanel({
  processId,
  nodes,
  edges,
}: ModulePanelProps) {
  const [result, setResult] = useState<AnalyticsResult | null>(null);

  const graphPayload = useMemo(
    () => ({
      process_id: processId === "demo" ? null : processId,
      graph: {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type ?? "task",
          position: n.position,
          data: n.data,
          width: null,
          height: null,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
          label: typeof e.label === "string" ? e.label : null,
          data: (e.data as Record<string, unknown> | undefined) ?? null,
          animated: e.animated ?? false,
        })),
      },
    }),
    [processId, nodes, edges],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const data = await api.post(
        "/modules/process_analytics/analyse",
        graphPayload,
      );
      return analyticsResultSchema.parse(data);
    },
    onSuccess: (data) => setResult(data),
  });

  const disabled = nodes.length === 0 || mutation.isPending;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-primary" />
          <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Analytics
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={disabled}
        >
          {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
          {result ? "Recompute" : "Analyse"}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!result && !mutation.isPending && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <BarChart3 size={22} className="text-text-faint" />
            <div className="text-sm">No analytics yet</div>
            <p className="max-w-[260px] text-xs text-text-muted">
              Click <span className="text-text">Analyse</span> to compute
              bottleneck rankings, utilisation, and a cycle-time distribution
              for the current graph.
            </p>
          </div>
        )}

        {mutation.isError && (
          <div className="m-4 flex items-start gap-2 rounded-md border border-error/30 bg-error/10 p-3 text-xs text-error">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>
              {mutation.error instanceof ApiError
                ? ((mutation.error.body as { detail?: string } | null)
                    ?.detail ?? mutation.error.message)
                : "Analysis failed."}
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-5 p-4">
            <section className="grid grid-cols-2 gap-2">
              <Stat
                label="Avg cycle time"
                value={formatDuration(result.avg_cycle_time_ms)}
              />
              <Stat
                label="P90 cycle time"
                value={formatDuration(result.p90_cycle_time_ms)}
              />
              <Stat label="Nodes" value={result.node_count.toString()} />
              <Stat label="Edges" value={result.edge_count.toString()} />
            </section>

            <section>
              <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                Critical bottlenecks
              </h4>
              {result.critical_bottlenecks.length === 0 ? (
                <p className="text-xs text-text-muted">
                  No bottlenecks above severity threshold.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {result.critical_bottlenecks.map((m) => (
                    <SeverityBar key={m.node_id} metric={m} />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                Cycle-time distribution
              </h4>
              <Histogram bins={result.cycle_time_histogram} />
            </section>

            <section>
              <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                All nodes (by severity)
              </h4>
              <ul className="space-y-1">
                {result.node_metrics.map((m) => (
                  <li
                    key={m.node_id}
                    className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                  >
                    <span className="flex-1 truncate">{m.label}</span>
                    <span className="tabular-nums text-text-muted">
                      {formatDuration(m.avg_duration_ms)}
                    </span>
                    <SeverityDot severity={m.severity} />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-surface-2 p-2">
      <div className="text-[10px] uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}

function SeverityBar({
  metric,
}: {
  metric: {
    node_id: string;
    label: string;
    severity: number;
    avg_duration_ms: number;
  };
}) {
  const pct = Math.round(metric.severity * 100);
  return (
    <li className="rounded-md border bg-surface-2 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex-1 truncate text-xs">{metric.label}</span>
        <span className="text-[11px] tabular-nums text-text-muted">
          {pct}% · {formatDuration(metric.avg_duration_ms)}
        </span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-offset">
        <div
          className="h-full rounded-full bg-warning"
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

function SeverityDot({ severity }: { severity: number }) {
  const cls =
    severity > 0.6
      ? "bg-error"
      : severity > 0.35
        ? "bg-warning"
        : "bg-success";
  return <span className={`h-2 w-2 rounded-full ${cls}`} aria-hidden />;
}

function Histogram({
  bins,
}: {
  bins: { lower_ms: number; upper_ms: number; count: number }[];
}) {
  if (bins.length === 0) {
    return (
      <p className="text-xs text-text-muted">Not enough data for a histogram.</p>
    );
  }
  const max = Math.max(...bins.map((b) => b.count), 1);
  return (
    <div className="flex h-24 items-end gap-0.5 rounded-md border bg-surface-2 p-2">
      {bins.map((b, i) => {
        const h = Math.max(2, Math.round((b.count / max) * 80));
        return (
          <div
            key={i}
            className="flex-1 rounded-sm bg-primary/60"
            style={{ height: `${h}px` }}
            title={`${formatDuration(b.lower_ms)} – ${formatDuration(b.upper_ms)}: ${b.count}`}
          />
        );
      })}
    </div>
  );
}
