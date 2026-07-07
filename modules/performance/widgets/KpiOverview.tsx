"use client";

import { formatDuration, formatNumber } from "@/lib/format";

import { usePerformanceKpis } from "../panel/queries";
import { CardShell, KpiGrid, KpiTile } from "./_kit";

export default function KpiOverview({ logId }: { logId: string }) {
  const { data, isLoading, isError } = usePerformanceKpis(logId);
  const s = data?.summary;
  return (
    <CardShell loading={isLoading} empty={isError || !s}>
      {s && (
        <KpiGrid>
          <KpiTile
            label="Cases"
            value={formatNumber(s.cases)}
            info="Number of cases (process runs, e.g. orders or tickets) in this log."
          />
          <KpiTile
            label="Events"
            value={formatNumber(s.events)}
            info="Total number of recorded steps across all cases."
          />
          <KpiTile
            label="Variants"
            value={formatNumber(s.variants)}
            info="Number of distinct paths cases take through the process. Many variants = little standardisation."
          />
          <KpiTile
            label="Throughput"
            value={`${formatNumber(s.throughput_cases_per_day)}/day`}
            info="How many cases the process handles per day on average, over the log's time span."
          />
          <KpiTile
            label="Avg cycle"
            value={formatDuration(s.avg_cycle_time_s)}
            info="Average time a case takes from its first to its last recorded event."
          />
          <KpiTile
            label="Median cycle"
            value={formatDuration(s.median_cycle_time_s)}
            info="Half of all cases finish within this time — barely affected by rare, very slow cases."
          />
          <KpiTile
            label="P90 cycle"
            value={formatDuration(s.p90_cycle_time_s)}
            info="90% of cases finish within this time; only the slowest 10% take longer."
          />
          <KpiTile
            label="Lead time"
            value={formatDuration(s.lead_time_s)}
            info="End-to-end time a case spends in the process (first to last event), including waiting between steps."
          />
        </KpiGrid>
      )}
    </CardShell>
  );
}
