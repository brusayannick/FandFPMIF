"use client";

import { formatNumber } from "@/lib/format";

import { MetricInfoHint } from "../panel/metric-info";
import { useComplexityMetrics } from "../panel/queries";
import { CardShell, KpiTile } from "./_kit";

const fmt = (n: number | null | undefined, digits = 2) =>
  n == null ? "–" : n.toLocaleString(undefined, { maximumFractionDigits: digits });

/** Headline EPA-based complexity measures for the log. */
export default function ComplexityMetrics({ logId }: { logId: string }) {
  const { data, isLoading, isError } = useComplexityMetrics(logId);
  const m = data?.basic;
  return (
    <CardShell loading={isLoading} empty={isError || !m}>
      {m && (
        <div className="grid grid-cols-2 gap-2">
          <KpiTile
            label="Magnitude"
            value={formatNumber(m.magnitude)}
            hint="events"
            info={<MetricInfoHint metricKey="magnitude" />}
          />
          <KpiTile
            label="Variety"
            value={formatNumber(m.variety)}
            hint="distinct activities"
            info={<MetricInfoHint metricKey="variety" />}
          />
          <KpiTile
            label="Distinct traces"
            value={`${fmt(m.distinct_traces_pct * 100, 1)}%`}
            info={<MetricInfoHint metricKey="distinct_traces_pct" />}
          />
          <KpiTile
            label="Avg trace len"
            value={fmt(m.trace_length_avg, 1)}
            info={<MetricInfoHint metricKey="trace_length" />}
          />
          <KpiTile
            label="Variant entropy"
            value={fmt(m.normalized_variant_entropy)}
            hint="normalized"
            info={<MetricInfoHint metricKey="variant_entropy" />}
          />
          <KpiTile
            label="Sequence entropy"
            value={fmt(m.normalized_sequence_entropy)}
            hint="normalized"
            info={<MetricInfoHint metricKey="sequence_entropy" />}
          />
          <KpiTile
            label="Lempel–Ziv"
            value={fmt(m.lempel_ziv)}
            info={<MetricInfoHint metricKey="lempel_ziv" />}
          />
          <KpiTile
            label="Pentland"
            value={fmt(m.pentland_process)}
            hint="process"
            info={<MetricInfoHint metricKey="pentland_process" />}
          />
        </div>
      )}
    </CardShell>
  );
}
