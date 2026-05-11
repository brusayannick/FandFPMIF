"use client";

import { Fragment, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  BarChart2,
  Braces,
  GitFork,
  Layers,
  Network,
  Timer,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, formatNumber } from "@/lib/format";

import {
  useComplexityCorrelations,
  useComplexityMetrics,
  useComplexityTemporal,
} from "./queries";
import type { ComplexityMetrics, TemporalWindow } from "./queries";

// ── Constants ─────────────────────────────────────────────────────────────────

const COLOURS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const METRIC_LABELS: Record<string, string> = {
  variant_entropy: "Variant Entropy",
  normalized_variant_entropy: "Variant Entropy (norm.)",
  sequence_entropy: "Sequence Entropy",
  normalized_sequence_entropy: "Seq. Entropy (norm.)",
  sequence_entropy_linear: "Seq. Entropy (linear)",
  sequence_entropy_linear_norm: "Seq. Entropy (linear, norm.)",
  sequence_entropy_exponential: "Seq. Entropy (exp.)",
  sequence_entropy_exponential_norm: "Seq. Entropy (exp., norm.)",
  lempel_ziv: "Lempel-Ziv",
  affinity: "Affinity",
  structure: "Structure",
  deviation_from_random: "Dev. from Random",
  pentland_task: "Pentland Task",
  pentland_process: "Pentland Process",
  magnitude: "Magnitude",
  variety: "Variety",
  support: "Support",
  level_of_detail: "Level of Detail",
  pct_distinct_traces: "% Distinct Traces",
  time_granularity_s: "Time Granularity",
  log_duration_s: "Log Duration",
  mean_trace_length: "Mean Trace Length",
  median_trace_length: "Median Trace Length",
  std_trace_length: "Trace Length Std",
  min_trace_length: "Min Trace Length",
  max_trace_length: "Max Trace Length",
};

// Metrics bounded in [0, 1] → used in radar chart
const RADAR_METRICS: (keyof ComplexityMetrics)[] = [
  "normalized_variant_entropy",
  "affinity",
  "structure",
  "deviation_from_random",
  "pct_distinct_traces",
];

const DEFAULT_TEMPORAL_METRICS: string[] = [
  "variant_entropy",
  "sequence_entropy",
  "affinity",
  "structure",
];

const TEMPORAL_METRIC_OPTIONS: string[] = [
  "variant_entropy",
  "sequence_entropy",
  "sequence_entropy_linear",
  "sequence_entropy_exponential",
  "lempel_ziv",
  "affinity",
  "structure",
  "deviation_from_random",
  "pct_distinct_traces",
  "mean_trace_length",
];

// ── Root panel ────────────────────────────────────────────────────────────────

export function ProcessComplexityPanel({
  logId,
}: {
  logId: string;
  moduleId: string;
}) {
  const metricsQ = useComplexityMetrics(logId);

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      {metricsQ.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : metricsQ.data ? (
        <MetricCards metrics={metricsQ.data.metrics} />
      ) : null}

      {/* Radar + heatmap */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-[var(--card-padding)]">
            <h3 className="mb-3 text-sm font-semibold">Complexity profile</h3>
            {metricsQ.isLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : metricsQ.data ? (
              <RadarViz metrics={metricsQ.data.metrics} />
            ) : (
              <EmptyCell />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-[var(--card-padding)]">
            <h3 className="mb-3 text-sm font-semibold">Metric correlations</h3>
            <CorrelationHeatmap logId={logId} />
          </CardContent>
        </Card>
      </div>

      {/* Temporal line chart */}
      <Card>
        <CardContent className="p-[var(--card-padding)]">
          <h3 className="mb-3 text-sm font-semibold">Complexity over time</h3>
          <TemporalChart logId={logId} />
        </CardContent>
      </Card>
    </div>
  );
}

// ── KPI cards ─────────────────────────────────────────────────────────────────

function MetricCards({ metrics }: { metrics: ComplexityMetrics }) {
  const f = (v: number | null | undefined, d = 3) =>
    v == null || isNaN(v as number) ? "—" : (v as number).toFixed(d);

  const cards: { icon: LucideIcon; title: string; value: string; subline: string }[] = [
    {
      icon: TrendingUp,
      title: "Variant Entropy",
      value: f(metrics.variant_entropy),
      subline: `norm. ${f(metrics.normalized_variant_entropy, 2)}  (EPA partition)`,
    },
    {
      icon: Activity,
      title: "Sequence Entropy",
      value: f(metrics.sequence_entropy),
      subline: `norm. ${f(metrics.normalized_sequence_entropy, 2)}  (EPA events)`,
    },
    {
      icon: Layers,
      title: "Lempel-Ziv",
      value: formatNumber(metrics.lempel_ziv),
      subline: "LZ76 phrases, global time-order",
    },
    {
      icon: GitFork,
      title: "Affinity",
      value: f(metrics.affinity, 3),
      subline: "weighted Jaccard of DF patterns",
    },
    {
      icon: Braces,
      title: "Structure",
      value: f(metrics.structure, 3),
      subline: `1 − DF edges / variety²  (variety ${formatNumber(metrics.variety)})`,
    },
    {
      icon: BarChart2,
      title: "Distinct Traces",
      value: `${f(metrics.pct_distinct_traces, 1)} %`,
      subline: `${formatNumber(metrics.support)} cases · ${formatNumber(metrics.variety)} activities`,
    },
    {
      icon: Network,
      title: "Pentland Process",
      value: f(metrics.pentland_process, 2),
      subline: `task complexity ${formatNumber(metrics.pentland_task)}`,
    },
    {
      icon: Timer,
      title: "Log duration",
      value: formatDuration(metrics.log_duration_s),
      subline: `${formatNumber(metrics.magnitude)} events · avg ${f(metrics.mean_trace_length, 1)} /trace`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
      <CardContent className="p-[var(--card-padding)]">
        <div className="flex items-center justify-between gap-2 text-muted-foreground">
          <span className="text-[10px] uppercase tracking-wide">{title}</span>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
        {subline && (
          <div className="mt-1 text-[11px] text-muted-foreground">{subline}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Radar chart ───────────────────────────────────────────────────────────────

function RadarViz({ metrics }: { metrics: ComplexityMetrics }) {
  const radarData = RADAR_METRICS.map((key) => {
    const raw = metrics[key];
    const v = raw == null || isNaN(raw as number) ? 0 : Math.max(0, Math.min(1, raw as number));
    return { metric: METRIC_LABELS[key] ?? key, value: v, fullMark: 1 };
  });

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={radarData} margin={{ top: 10, right: 24, bottom: 10, left: 24 }}>
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis
            dataKey="metric"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 1]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 9 }}
          />
          <Radar
            name="Score"
            dataKey="value"
            stroke="var(--primary)"
            fill="var(--primary)"
            fillOpacity={0.25}
          />
          <Tooltip
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(v) => [typeof v === "number" ? v.toFixed(3) : v, "value"]}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Temporal line chart ───────────────────────────────────────────────────────

function TemporalChart({ logId }: { logId: string }) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(DEFAULT_TEMPORAL_METRICS),
  );
  const temporalQ = useComplexityTemporal(logId);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (temporalQ.isLoading) return <Skeleton className="h-80 w-full" />;
  if (!temporalQ.data || temporalQ.data.windows.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        Not enough temporal data — try a larger log or a finer window.
      </div>
    );
  }

  const windows = temporalQ.data.windows;

  // Min-max normalise per metric across windows for comparability
  const minMax: Record<string, [number, number]> = {};
  for (const key of selected) {
    const vals = windows
      .map((w) => (w.metrics as unknown as Record<string, number | null>)[key])
      .filter((v): v is number => v != null && isFinite(v));
    if (vals.length === 0) continue;
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    minMax[key] = [mn, mx === mn ? mn + 1 : mx];
  }

  const chartData = windows.map((w: TemporalWindow) => {
    const row: Record<string, number | string> = { label: w.label };
    for (const key of selected) {
      const raw = (w.metrics as unknown as Record<string, number | null>)[key];
      if (raw == null || !isFinite(raw)) continue;
      const [mn, mx] = minMax[key] ?? [0, 1];
      row[key] = (raw - mn) / (mx - mn);
    }
    return row;
  });

  const selectedArr = Array.from(selected);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {TEMPORAL_METRIC_OPTIONS.map((key, i) => {
          const on = selected.has(key);
          const colour = COLOURS[i % COLOURS.length];
          return (
            <button
              key={key}
              onClick={() => toggle(key)}
              className="rounded-full border px-2 py-0.5 text-[10px] transition-colors"
              style={{
                borderColor: on ? colour : "var(--border)",
                background: on ? colour + "22" : "transparent",
                color: on ? "var(--foreground)" : "var(--muted-foreground)",
              }}
            >
              {METRIC_LABELS[key] ?? key}
            </button>
          );
        })}
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              interval="preserveStartEnd"
              stroke="var(--border)"
              angle={-30}
              textAnchor="end"
            />
            <YAxis
              domain={[0, 1]}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              stroke="var(--border)"
              tickFormatter={(v) => v.toFixed(1)}
            />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(v, name) => [
                typeof v === "number" ? v.toFixed(3) : v,
                METRIC_LABELS[String(name)] ?? name,
              ]}
            />
            <Legend
              formatter={(name) => METRIC_LABELS[name] ?? name}
              wrapperStyle={{ fontSize: 10 }}
            />
            {selectedArr.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={COLOURS[i % COLOURS.length]}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Values min-max normalised per metric for comparability.
      </p>
    </div>
  );
}

// ── Correlation heatmap ───────────────────────────────────────────────────────

function CorrelationHeatmap({ logId }: { logId: string }) {
  const corrQ = useComplexityCorrelations(logId);

  if (corrQ.isLoading) return <Skeleton className="h-72 w-full" />;
  if (!corrQ.data || corrQ.data.metrics.length < 2) {
    return (
      <div className="text-xs text-muted-foreground">
        At least 2 temporal windows are needed to compute correlations.
      </div>
    );
  }

  const { metrics, matrix } = corrQ.data;
  const short = metrics.map((m) =>
    (METRIC_LABELS[m] ?? m).replace(/\s*\(.*\)/, "").slice(0, 11),
  );
  const n = metrics.length;

  function corrToColour(r: number): string {
    const c = Math.max(-1, Math.min(1, r));
    if (c >= 0) {
      const t = c;
      return `rgb(${Math.round(220 + 35 * t)},${Math.round(220 * (1 - t))},${Math.round(220 * (1 - t))})`;
    }
    const t = -c;
    return `rgb(${Math.round(220 * (1 - t))},${Math.round(220 * (1 - t))},${Math.round(220 + 35 * t)})`;
  }

  const cellSize = Math.max(24, Math.min(44, Math.floor(280 / n)));

  return (
    <div className="overflow-auto">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `72px repeat(${n}, ${cellSize}px)`,
          gap: 1,
          fontSize: 9,
        }}
      >
        {/* Column headers */}
        <div />
        {short.map((s, j) => (
          <div
            key={j}
            className="overflow-hidden text-center text-[9px] text-muted-foreground"
            style={{ height: 20, transform: "rotate(-45deg)", transformOrigin: "bottom left" }}
            title={metrics[j]}
          >
            {s}
          </div>
        ))}

        {/* Rows */}
        {metrics.map((rowKey, i) => (
          <Fragment key={rowKey}>
            <div
              className="flex items-center justify-end pr-1 text-[9px] text-muted-foreground"
              style={{ height: cellSize }}
              title={rowKey}
            >
              {short[i]}
            </div>
            {matrix[i].map((r, j) => (
              <div
                key={j}
                title={`${metrics[i]} × ${metrics[j]}: ${r.toFixed(2)}`}
                className="flex items-center justify-center rounded-sm text-[8px] font-medium"
                style={{
                  background: corrToColour(r),
                  color: Math.abs(r) > 0.6 ? "#fff" : "#333",
                  width: cellSize,
                  height: cellSize,
                }}
              >
                {r.toFixed(1)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span
          className="inline-block h-3 w-8 rounded-sm"
          style={{
            background:
              "linear-gradient(to right, rgb(150,150,255), rgb(220,220,220), rgb(255,150,150))",
          }}
        />
        <span>−1 (blue) → 0 → +1 (red) · Pearson r across time windows</span>
      </div>
    </div>
  );
}

// ── Util ──────────────────────────────────────────────────────────────────────

function EmptyCell() {
  return (
    <div className="flex h-72 items-center justify-center text-xs text-muted-foreground">
      No data
    </div>
  );
}
