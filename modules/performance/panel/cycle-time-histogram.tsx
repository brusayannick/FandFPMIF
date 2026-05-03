"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatDuration } from "@/lib/format";
import type { CycleTimeDistribution } from "./queries";

interface CycleTimeHistogramProps {
  data: CycleTimeDistribution;
}

export function CycleTimeHistogram({ data }: CycleTimeHistogramProps) {
  const chartData = data.buckets.map((b) => ({
    label: formatDuration((b.bucket_min + b.bucket_max) / 2),
    midpoint: (b.bucket_min + b.bucket_max) / 2,
    count: b.count,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 16 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            interval="preserveStartEnd"
            stroke="var(--border)"
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            stroke="var(--border)"
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--card-foreground)" }}
            formatter={(value) => [String(value), "cases"]}
          />
          <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
          <ReferenceLine
            x={chartData.findIndex((d) => d.midpoint >= data.stats.median_cycle_time_s)}
            stroke="var(--chart-2)"
            strokeDasharray="3 3"
            label={{
              value: "median",
              fill: "var(--chart-2)",
              position: "top",
              fontSize: 10,
            }}
          />
          <ReferenceLine
            x={chartData.findIndex((d) => d.midpoint >= data.stats.p90_cycle_time_s)}
            stroke="var(--chart-4)"
            strokeDasharray="3 3"
            label={{ value: "p90", fill: "var(--chart-4)", position: "top", fontSize: 10 }}
          />
          <ReferenceLine
            x={chartData.findIndex((d) => d.midpoint >= data.stats.p95_cycle_time_s)}
            stroke="var(--chart-1)"
            strokeDasharray="3 3"
            label={{ value: "p95", fill: "var(--chart-1)", position: "top", fontSize: 10 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
