"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Play, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import { subscribeJob } from "@/lib/ws";

import { ConformanceBpmnCanvas } from "./canvases/ConformanceBpmnCanvas";
import { buildDeviationMaps } from "./conformance-decorate";
import { DeviationTable } from "./deviation-table";
import { LabelReportBanner } from "./label-report";
import { ModelManager } from "./model-manager";
import { confKeys, useConformanceResults, useRunConformance } from "./queries";
import type { Technique } from "./types";

export default function ConformancePanel({ logId }: { logId: string; moduleId: string }) {
  const qc = useQueryClient();
  const [technique, setTechnique] = useState<Technique>("token_replay");
  const [decor, setDecor] = useState({ heatmap: true, labels: true });
  const [jobId, setJobId] = useState<string | null>(null);

  const resultsQ = useConformanceResults(logId, technique);
  const runMut = useRunConformance(logId);
  const running = Boolean(jobId) || runMut.isPending;

  // Follow the run job to completion, then refresh the cached results.
  useEffect(() => {
    if (!jobId) return;
    const sub = subscribeJob(jobId, (env) => {
      if (env.topic === "job.completed") {
        setJobId(null);
        void qc.invalidateQueries({ queryKey: ["modules", "conformance", "results", logId] });
        toast.success("Conformance check complete");
      } else if (env.topic === "job.failed") {
        setJobId(null);
        const msg = (env.payload as { error?: string })?.error ?? "unknown error";
        toast.error(`Conformance run failed: ${msg}`);
      } else if (env.topic === "job.cancelled") {
        setJobId(null);
      }
    });
    return () => sub.close();
  }, [jobId, logId, qc]);

  const startRun = () => {
    runMut.mutate(technique, {
      onSuccess: (r) => setJobId(r.job_id),
      onError: (e) => toast.error(`Could not start run: ${e.message}`),
    });
  };

  const data = resultsQ.data;
  const maps = useMemo(() => buildDeviationMaps(data?.per_activity), [data?.per_activity]);
  const kpis = data?.kpis;

  const chartRows = (data?.per_activity ?? [])
    .filter((a) => a.deviations > 0)
    .slice(0, 10)
    .map((a) => ({ activity: a.activity, deviations: a.deviations }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Reference model</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="conf-technique" className="text-xs text-muted-foreground">
              Technique
            </Label>
            <Select
              value={technique}
              onValueChange={(v) => setTechnique(v as Technique)}
              disabled={running}
            >
              <SelectTrigger id="conf-technique" className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="token_replay">Token-based replay</SelectItem>
                <SelectItem value="alignments">Alignments (precise)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <ModelManager
            logId={logId}
            running={running}
            onRun={startRun}
            onModelReady={startRun}
          />
        </CardContent>
      </Card>

      {resultsQ.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : running && !data?.ran ? (
        <EmptyState
          icon={Sparkles}
          title="Checking conformance…"
          description="Replaying the event log against your reference model. This can take a moment for large logs."
        />
      ) : !data?.has_model ? (
        <EmptyState
          icon={Upload}
          title="Upload a reference BPMN"
          description="Add the process model you expect the log to follow, then run a conformance check to see where reality diverges."
        />
      ) : !data.ran ? (
        <EmptyState
          icon={Play}
          title="Reference model ready"
          description="Run a conformance check to compute fitness, precision and per-activity deviations."
          primaryAction={
            <Button size="sm" className="cursor-pointer gap-2" onClick={startRun} disabled={running}>
              <Play className="h-3.5 w-3.5" /> Run conformance
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <LabelReportBanner report={data.label_report} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile label="Fitness" value={pct(kpis?.log_fitness)} tone="primary" />
            <KpiTile
              label="Precision"
              value={pct(kpis?.precision)}
              hint={data.precision_skipped ?? undefined}
            />
            <KpiTile label="Conforming traces" value={pct01(kpis?.perc_fit_traces)} />
            <KpiTile label="Deviations" value={formatNumber(kpis?.total_deviations ?? 0)} tone="danger" />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">Deviations on the model</CardTitle>
              <div className="flex items-center gap-4">
                <ToggleSwitch
                  id="conf-heatmap"
                  label="Heatmap"
                  checked={decor.heatmap}
                  onChange={(v) => setDecor((d) => ({ ...d, heatmap: v }))}
                />
                <ToggleSwitch
                  id="conf-labels"
                  label="Counts"
                  checked={decor.labels}
                  onChange={(v) => setDecor((d) => ({ ...d, labels: v }))}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative h-[640px] w-full overflow-hidden rounded-xl border bg-card">
                {data.bpmn_xml ? (
                  <ConformanceBpmnCanvas
                    key={`${data.model_hash ?? "m"}-${technique}`}
                    xml={data.bpmn_xml}
                    maps={maps}
                    decor={{ ...decor, alignments: technique === "alignments" }}
                  />
                ) : (
                  <Skeleton className="h-full w-full" />
                )}
              </div>
              <Legend />
            </CardContent>
          </Card>

          {chartRows.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Most deviating activities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={chartRows}
                      margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" horizontal={false} />
                      <XAxis
                        type="number"
                        tickFormatter={(v) => formatNumber(v)}
                        tick={{ fontSize: 10 }}
                        stroke="currentColor"
                        className="text-muted-foreground"
                      />
                      <YAxis
                        type="category"
                        dataKey="activity"
                        width={120}
                        tick={{ fontSize: 10 }}
                        stroke="currentColor"
                        className="text-muted-foreground"
                      />
                      <Tooltip
                        formatter={(v: number) => [formatNumber(v), "Deviations"]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Bar dataKey="deviations" className="fill-red-500/80" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Deviation breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <DeviationTable
                perActivity={data.per_activity ?? []}
                perVariant={data.per_variant ?? []}
                technique={technique}
              />
              {data.per_case_truncated ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing the most-deviating cases; the full per-case list is truncated.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function pct(value: number | null | undefined): string {
  if (value === undefined || value === null) return "–";
  return `${(value * 100).toFixed(1)}%`;
}
function pct01(value: number | null | undefined): string {
  // Already a 0..100 percentage from the backend.
  if (value === undefined || value === null) return "–";
  return `${value.toFixed(1)}%`;
}

function KpiTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "primary" | "danger";
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={
          "mt-0.5 truncate text-lg font-semibold tabular-nums tracking-tight" +
          (tone === "primary" ? " text-primary" : tone === "danger" ? " text-red-600 dark:text-red-500" : "")
        }
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-muted-foreground" title={hint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function ToggleSwitch({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="cursor-pointer text-xs text-muted-foreground">
        {label}
      </Label>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <LegendSwatch className="bg-emerald-500/30 border-emerald-500/60" label="Conforming" />
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-3 w-8 rounded-sm border border-red-500/70 bg-gradient-to-r from-red-500/15 to-red-600/90"
          aria-hidden
        />
        Deviating — deeper red = more deviations
      </span>
      <LegendSwatch
        className="border-dashed border-amber-500/70 bg-amber-500/20"
        label="Model task not found in log"
      />
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-4 rounded-sm border ${className}`} aria-hidden />
      {label}
    </span>
  );
}
