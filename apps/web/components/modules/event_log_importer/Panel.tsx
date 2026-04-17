"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";
import { graphSchema } from "@/lib/schemas/graph";
import { useProcessStore } from "@/stores/process.store";
import type { ModulePanelProps } from "@/types/module";
import { z } from "zod";

const activityStatSchema = z.object({
  activity: z.string(),
  frequency: z.number().int(),
});

const edgeStatSchema = z.object({
  source: z.string(),
  target: z.string(),
  frequency: z.number().int(),
});

const importResultSchema = z.object({
  graph: graphSchema,
  num_cases: z.number().int(),
  num_events: z.number().int(),
  num_activities: z.number().int(),
  num_variants: z.number().int(),
  top_activities: z.array(activityStatSchema).default([]),
  top_edges: z.array(edgeStatSchema).default([]),
  start_activities: z.array(z.string()).default([]),
  end_activities: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

type ImportResult = z.infer<typeof importResultSchema>;

interface UploadParams {
  file: File;
  caseIdColumn: string;
  activityColumn: string;
  timestampColumn: string;
  noiseThreshold: number;
  showFrequencies: boolean;
}

async function uploadEventLog(params: UploadParams): Promise<ImportResult> {
  const fd = new FormData();
  fd.append("file", params.file);
  if (params.caseIdColumn) fd.append("case_id_column", params.caseIdColumn);
  if (params.activityColumn) fd.append("activity_column", params.activityColumn);
  if (params.timestampColumn) fd.append("timestamp_column", params.timestampColumn);
  fd.append("noise_threshold", String(params.noiseThreshold));
  fd.append("show_frequencies", String(params.showFrequencies));

  const res = await fetch("/api/modules/event_log_importer/import", {
    method: "POST",
    body: fd,
  });
  const ct = res.headers.get("content-type") ?? "";
  const payload = ct.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, payload);
  }
  return importResultSchema.parse(payload);
}

export function EventLogImporterPanel(_props: ModulePanelProps) {
  void _props;
  const syncFromServer = useProcessStore((s) => s.syncFromServer);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [caseIdColumn, setCaseIdColumn] = useState("case:concept:name");
  const [activityColumn, setActivityColumn] = useState("concept:name");
  const [timestampColumn, setTimestampColumn] = useState("time:timestamp");
  const [noiseThreshold, setNoiseThreshold] = useState(0);
  const [showFrequencies, setShowFrequencies] = useState(true);

  const mutation = useMutation({
    mutationFn: uploadEventLog,
    onSuccess: (data) => {
      setResult(data);
      syncFromServer(data.graph);
      toast.success(
        `Imported ${data.num_events.toLocaleString()} events from ${data.num_cases.toLocaleString()} cases`,
        {
          description: `${data.num_activities} activities · ${data.num_variants} variants`,
        },
      );
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError
          ? ((err.body as { detail?: string } | null)?.detail ??
            `HTTP ${err.status}`)
          : "Import failed";
      toast.error("Event log import failed", { description: msg });
    },
  });

  const isCsv = selectedFile?.name.toLowerCase().endsWith(".csv") ?? false;

  function onFileSelected(file: File | undefined) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (
      !name.endsWith(".xes") &&
      !name.endsWith(".xes.gz") &&
      !name.endsWith(".csv")
    ) {
      toast.error("Only .xes, .xes.gz, or .csv files are supported");
      return;
    }
    setSelectedFile(file);
    setResult(null);
  }

  function handleImport() {
    if (!selectedFile) return;
    mutation.mutate({
      file: selectedFile,
      caseIdColumn,
      activityColumn,
      timestampColumn,
      noiseThreshold,
      showFrequencies,
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <FileSpreadsheet size={14} className="text-primary" />
        <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Event Log Importer
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!selectedFile && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onFileSelected(e.dataTransfer.files?.[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed bg-surface-2 p-6 text-center transition-colors",
              dragging
                ? "border-primary bg-primary-highlight"
                : "border-border hover:border-primary/50",
            )}
          >
            <Upload size={20} className="text-text-muted" />
            <div className="text-sm">
              Drop an event log or click to browse
            </div>
            <p className="max-w-[240px] text-[11px] text-text-muted">
              Supports <code>.xes</code>, <code>.xes.gz</code>, and{" "}
              <code>.csv</code>. Analysed with pm4py.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xes,.gz,.csv,application/xml,text/csv"
              className="hidden"
              onChange={(e) => {
                onFileSelected(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Browse files
            </Button>
          </div>
        )}

        {selectedFile && (
          <div className="space-y-3 rounded-md border bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {selectedFile.name}
                </div>
                <div className="text-[11px] text-text-muted">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedFile(null);
                  setResult(null);
                }}
                disabled={mutation.isPending}
              >
                Change
              </Button>
            </div>

            {isCsv && (
              <div className="space-y-2 border-t pt-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-text-faint">
                  CSV column mapping
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="csv-case" className="text-xs">
                    Case ID column
                  </Label>
                  <Input
                    id="csv-case"
                    value={caseIdColumn}
                    onChange={(e) => setCaseIdColumn(e.target.value)}
                    placeholder="e.g. case_id"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="csv-activity" className="text-xs">
                    Activity column
                  </Label>
                  <Input
                    id="csv-activity"
                    value={activityColumn}
                    onChange={(e) => setActivityColumn(e.target.value)}
                    placeholder="e.g. activity"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="csv-ts" className="text-xs">
                    Timestamp column
                  </Label>
                  <Input
                    id="csv-ts"
                    value={timestampColumn}
                    onChange={(e) => setTimestampColumn(e.target.value)}
                    placeholder="e.g. timestamp"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2 border-t pt-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-text-faint">
                Discovery options
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="noise" className="text-xs">
                  Noise threshold ({(noiseThreshold * 100).toFixed(0)}%)
                </Label>
                <input
                  id="noise"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={noiseThreshold}
                  onChange={(e) => setNoiseThreshold(parseFloat(e.target.value))}
                  className="w-full accent-primary"
                />
                <p className="text-[10px] text-text-muted">
                  Prune edges with frequency below this ratio of the most
                  frequent edge.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={showFrequencies}
                  onChange={(e) => setShowFrequencies(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Show frequencies in node &amp; edge labels
              </label>
            </div>

            <Button
              type="button"
              className="w-full"
              onClick={handleImport}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Analysing…
                </>
              ) : (
                <>Discover DFG</>
              )}
            </Button>
          </div>
        )}

        {mutation.isError && (
          <div className="flex items-start gap-2 rounded-md border border-error/30 bg-error/10 p-3 text-xs text-error">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>
              {mutation.error instanceof ApiError
                ? ((mutation.error.body as { detail?: string } | null)
                    ?.detail ?? mutation.error.message)
                : "Import failed."}
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <section className="grid grid-cols-2 gap-2">
              <Stat label="Cases" value={result.num_cases.toLocaleString()} />
              <Stat label="Events" value={result.num_events.toLocaleString()} />
              <Stat
                label="Activities"
                value={result.num_activities.toString()}
              />
              <Stat label="Variants" value={result.num_variants.toString()} />
            </section>

            {result.top_activities.length > 0 && (
              <section>
                <h4 className="mb-1.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                  <BarChart3 size={10} /> Top activities
                </h4>
                <FrequencyBars
                  items={result.top_activities.map((a) => ({
                    label: a.activity,
                    value: a.frequency,
                  }))}
                />
              </section>
            )}

            {result.top_edges.length > 0 && (
              <section>
                <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-faint">
                  Top transitions
                </h4>
                <FrequencyBars
                  items={result.top_edges.map((e) => ({
                    label: `${e.source} → ${e.target}`,
                    value: e.frequency,
                  }))}
                />
              </section>
            )}

            {result.warnings.length > 0 && (
              <section className="rounded-md border border-warning/30 bg-warning/10 p-2 text-[11px] text-warning">
                {result.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </section>
            )}

            <p className="text-[11px] text-text-muted">
              DFG rendered on the canvas. Save to persist as a process.
            </p>
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

function FrequencyBars({
  items,
}: {
  items: { label: string; value: number }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="space-y-0.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="truncate text-text-muted">{item.label}</span>
            <span className="shrink-0 tabular-nums text-text-faint">
              {item.value.toLocaleString()}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface-offset">
            <div
              className="h-full bg-primary"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
