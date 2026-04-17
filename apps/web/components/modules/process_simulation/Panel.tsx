"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Activity, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";
import { formatDuration, formatNumber } from "@/lib/utils";
import type { ModulePanelProps } from "@/types/module";
import { z } from "zod";

const percentileSchema = z.object({
  p50: z.number(),
  p75: z.number(),
  p90: z.number(),
  p95: z.number(),
  p99: z.number(),
});

const tsPointSchema = z.object({
  t_hours: z.number(),
  completed: z.number().int(),
});

const simulationResultSchema = z.object({
  generated_at: z.string(),
  process_id: z.string().nullable(),
  n_runs: z.number().int(),
  mean_cycle_time_ms: z.number(),
  median_cycle_time_ms: z.number(),
  min_cycle_time_ms: z.number(),
  max_cycle_time_ms: z.number(),
  std_cycle_time_ms: z.number(),
  confidence_interval_95: z.tuple([z.number(), z.number()]),
  percentiles: percentileSchema,
  throughput_per_hour: z.number(),
  utilization: z.number(),
  time_series: z.array(tsPointSchema),
  warnings: z.array(z.string()).default([]),
});

type SimulationResult = z.infer<typeof simulationResultSchema>;

export function ProcessSimulationPanel({
  processId,
  nodes,
  edges,
}: ModulePanelProps) {
  const [config, setConfig] = useState({
    n_runs: 500,
    arrival_rate_per_hour: 10,
    resource_capacity: 3,
    duration_variance: 0.3,
  });
  const [result, setResult] = useState<SimulationResult | null>(null);

  const graphPayload = useMemo(
    () => ({
      process_id: processId === "demo" ? null : processId,
      config,
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
    [processId, nodes, edges, config],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const data = await api.post(
        "/modules/process_simulation/run",
        graphPayload,
      );
      return simulationResultSchema.parse(data);
    },
    onSuccess: (data) => setResult(data),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-primary" />
          <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Simulation
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={nodes.length === 0 || mutation.isPending}
        >
          {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
          Run
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3 border-b p-4">
          <div className="space-y-1">
            <Label htmlFor="sim-runs" className="text-xs">
              Runs
            </Label>
            <Input
              id="sim-runs"
              type="number"
              min={10}
              max={10000}
              value={config.n_runs}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  n_runs: Math.max(
                    10,
                    Math.min(10000, Number(e.target.value) || 10),
                  ),
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sim-arrival" className="text-xs">
              Arrivals / hr
            </Label>
            <Input
              id="sim-arrival"
              type="number"
              step="0.1"
              min={0.1}
              value={config.arrival_rate_per_hour}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  arrival_rate_per_hour: Math.max(
                    0.1,
                    Number(e.target.value) || 1,
                  ),
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sim-capacity" className="text-xs">
              Resource capacity
            </Label>
            <Input
              id="sim-capacity"
              type="number"
              min={1}
              value={config.resource_capacity}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  resource_capacity: Math.max(1, Number(e.target.value) || 1),
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sim-variance" className="text-xs">
              Duration variance
            </Label>
            <Input
              id="sim-variance"
              type="number"
              step="0.05"
              min={0}
              max={2}
              value={config.duration_variance}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  duration_variance: Math.max(
                    0,
                    Math.min(2, Number(e.target.value) || 0),
                  ),
                }))
              }
            />
          </div>
        </div>

        {!result && !mutation.isPending && !mutation.isError && (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <Activity size={22} className="text-text-faint" />
            <div className="text-sm">Ready to simulate</div>
            <p className="max-w-[260px] text-xs text-text-muted">
              Configure parameters and run a Monte Carlo simulation over this
              graph. The graph must contain at least one start and one end
              event.
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
                : "Simulation failed."}
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-5 p-4">
            <section className="grid grid-cols-2 gap-2">
              <Stat
                label="Mean cycle"
                value={formatDuration(result.mean_cycle_time_ms)}
              />
              <Stat
                label="95% CI"
                value={`±${formatDuration(
                  (result.confidence_interval_95[1] -
                    result.confidence_interval_95[0]) /
                    2,
                )}`}
              />
              <Stat
                label="Throughput/hr"
                value={formatNumber(
                  Math.round(result.throughput_per_hour * 10) / 10,
                )}
              />
              <Stat
                label="Utilisation"
                value={`${Math.round(result.utilization * 100)}%`}
              />
            </section>

            <section>
              <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                Percentiles
              </h4>
              <ul className="grid grid-cols-5 gap-1 text-center">
                {(["p50", "p75", "p90", "p95", "p99"] as const).map((k) => (
                  <li key={k} className="rounded-md border bg-surface-2 p-1.5">
                    <div className="text-[9px] uppercase text-text-faint">
                      {k}
                    </div>
                    <div className="text-[11px] tabular-nums">
                      {formatDuration(result.percentiles[k])}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                Completed over time (n={result.n_runs})
              </h4>
              <TimeSeries points={result.time_series} />
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

function TimeSeries({
  points,
}: {
  points: { t_hours: number; completed: number }[];
}) {
  if (points.length === 0) {
    return (
      <p className="text-xs text-text-muted">Not enough data for a chart.</p>
    );
  }
  const max = Math.max(...points.map((p) => p.completed), 1);
  const maxT = Math.max(...points.map((p) => p.t_hours), 0.001);
  const w = 260;
  const h = 80;
  const dx = w / Math.max(1, points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * dx;
      const y = h - (p.completed / max) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="rounded-md border bg-surface-2 p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full">
        <path d={path} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-text-faint">
        <span>0h</span>
        <span className="tabular-nums">
          {maxT.toFixed(maxT < 1 ? 2 : 1)}h
        </span>
      </div>
    </div>
  );
}
