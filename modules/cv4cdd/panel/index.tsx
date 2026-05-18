"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Waves,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { subscribeBus } from "@/lib/ws";
import { cn } from "@/lib/cn";

import { useCv4cddResults, useRunCv4cdd, type Cv4cddDrift } from "./queries";

// ── Drift-type metadata ───────────────────────────────────────────────────────

const DRIFT_META: Record<
  string,
  { icon: LucideIcon; colour: string; label: string; explainer: string }
> = {
  sudden: {
    icon: Zap,
    colour: "rgb(120,120,120)",
    label: "Sudden",
    explainer: "A single point where the process abruptly changes.",
  },
  gradual: {
    icon: TrendingUp,
    colour: "rgb(30,144,255)",
    label: "Gradual",
    explainer: "Old and new variants co-exist for a while before the switch completes.",
  },
  incremental: {
    icon: TrendingDown,
    colour: "rgb(217,70,239)",
    label: "Incremental",
    explainer: "The process drifts in a series of small adjustments over time.",
  },
  recurring: {
    icon: Waves,
    colour: "rgb(34,211,238)",
    label: "Recurring",
    explainer: "An earlier process version returns and replaces the current one.",
  },
};

// ── Panel ─────────────────────────────────────────────────────────────────────

export function Cv4cddPanel({ logId }: { logId: string; moduleId: string }) {
  const resultsQ = useCv4cddResults(logId);
  const run = useRunCv4cdd(logId);

  // Tracks an in-flight detection so we can show the "running" state and a
  // progress hint until the WebSocket bus pushes `job.completed`.
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ pct: number; msg: string } | null>(
    null,
  );

  // Cache-buster for the <img> src so the browser refetches after each run.
  const [imageNonce, setImageNonce] = useState<number>(() => Date.now());

  // Subscribe to job events; flip the running state off + refetch when our job
  // wraps up. Cleanup the socket on unmount so we don't keep an idle handle open.
  useEffect(() => {
    if (!runningJobId) return;
    const sub = subscribeBus<Record<string, unknown>>(["job.*"], (env) => {
      if ((env.payload?.id as string | undefined) !== runningJobId) return;

      if (env.topic === "job.progress") {
        const current = Number(env.payload.current ?? 0);
        const total = Number(env.payload.total ?? 100) || 100;
        setProgress({
          pct: total > 0 ? (current / total) * 100 : 0,
          msg: String(env.payload.message ?? ""),
        });
        return;
      }
      if (
        env.topic === "job.completed" ||
        env.topic === "job.failed" ||
        env.topic === "job.cancelled"
      ) {
        setRunningJobId(null);
        setProgress(null);
        setImageNonce(Date.now());
        void resultsQ.refetch();
      }
    });
    return () => sub.close();
  }, [runningJobId, resultsQ]);

  const onRun = async () => {
    try {
      const { job_id } = await run.mutateAsync();
      setRunningJobId(job_id);
      setProgress({ pct: 0, msg: "Starting…" });
    } catch {
      // Errors are surfaced via the global toast in the api wrapper.
    }
  };

  const data = resultsQ.data;
  const drifts: Cv4cddDrift[] = data?.drifts ?? [];
  const hasResults = Boolean(data?.ran);

  return (
    <div className="space-y-6">
      <Header
        running={Boolean(runningJobId)}
        onRun={onRun}
        progress={progress}
        hasResults={hasResults}
      />

      {resultsQ.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : !hasResults && !runningJobId ? (
        <EmptyState
          icon={Sparkles}
          title="No drifts detected yet"
          description="Run the CV4CDD detector on this event log. A fine-tuned computer-vision model will scan a similarity-matrix encoding of the log for sudden, gradual, incremental, and recurring concept drifts."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr]">
          <DriftsCard
            drifts={drifts}
            running={Boolean(runningJobId)}
            threshold={data?.confidence_threshold}
            nWindows={data?.n_windows}
          />
          <ImageCard
            logId={logId}
            nonce={imageNonce}
            running={Boolean(runningJobId)}
          />
        </div>
      )}
    </div>
  );
}

// ── Header / run controls ─────────────────────────────────────────────────────

function Header({
  running,
  onRun,
  progress,
  hasResults,
}: {
  running: boolean;
  onRun: () => void;
  progress: { pct: number; msg: string } | null;
  hasResults: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Concept drift detection</CardTitle>
        <CardAction>
          <Button
            onClick={onRun}
            disabled={running}
            size="sm"
            className="shrink-0 gap-1.5"
          >
            {running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Detecting…
              </>
            ) : hasResults ? (
              <>
                <RotateCcw className="h-3.5 w-3.5" />
                Re-run detection
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Run detection
              </>
            )}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Kraus & van der Aa (2024) — CV4CDD-4D. The log is encoded as a
          window-pair similarity matrix; an object-detection model trained
          on synthetic drifts localises the drift bounding boxes.
        </p>
        {running && progress && (
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width] duration-200"
                style={{ width: `${Math.max(2, Math.min(100, progress.pct))}%` }}
              />
            </div>
            {progress.msg && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {progress.msg}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Overlay image ─────────────────────────────────────────────────────────────

function ImageCard({
  logId,
  nonce,
  running,
}: {
  logId: string;
  nonce: number;
  running: boolean;
}) {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const src = `${apiBase}/api/v1/modules/cv4cdd/image?log_id=${encodeURIComponent(
    logId,
  )}&t=${nonce}`;
  const imgRef = useRef<HTMLImageElement>(null);
  const [errored, setErrored] = useState(false);

  // Reset the error flag whenever the nonce changes (a new run finished).
  useEffect(() => {
    setErrored(false);
  }, [nonce]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Drift map</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Pairwise window-similarity matrix (viridis). Detected drifts are
          shown as coloured bounding boxes — the x-axis is time.
        </p>
        <div
          className={cn(
            "relative w-[70%] overflow-hidden rounded-md border bg-muted/30",
            running && "opacity-60",
          )}
          style={{ aspectRatio: "1 / 1" }}
        >
          {errored ? (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              <AlertTriangle className="mr-2 h-4 w-4" />
              Image not yet available
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={src}
              alt="CV4CDD drift map with bounding boxes"
              className="h-full w-full object-contain"
              onError={() => setErrored(true)}
            />
          )}
          {running && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-foreground/70" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Drifts table ──────────────────────────────────────────────────────────────

function DriftsCard({
  drifts,
  running,
  threshold,
  nWindows,
}: {
  drifts: Cv4cddDrift[];
  running: boolean;
  threshold?: number;
  nWindows?: number;
}) {
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of drifts) out[d.type] = (out[d.type] ?? 0) + 1;
    return out;
  }, [drifts]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Detected drifts</CardTitle>
        {(threshold !== undefined || nWindows) && (
          <CardAction>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {threshold !== undefined && `confidence ≥ ${(threshold * 100).toFixed(0)}%`}
              {nWindows ? ` · ${nWindows} windows` : null}
            </span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {Object.keys(counts).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(counts).map(([type, n]) => {
              const meta = DRIFT_META[type];
              const Icon = meta?.icon ?? Sparkles;
              return (
                <Badge
                  key={type}
                  variant="secondary"
                  className="gap-1 border-0 px-2 py-0.5 text-[10px]"
                  style={{
                    background: `${meta?.colour ?? "var(--muted)"}22`,
                    color: meta?.colour ?? "var(--foreground)",
                  }}
                >
                  <Icon className="h-3 w-3" />
                  {meta?.label ?? type} · {n}
                </Badge>
              );
            })}
          </div>
        )}

        {drifts.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {running
              ? "Detection running — drifts will appear here."
              : "The model didn't find any drifts above the confidence threshold."}
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs">Start</TableHead>
                  <TableHead className="text-xs">End</TableHead>
                  <TableHead className="text-right text-xs">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drifts.map((d, i) => {
                  const meta = DRIFT_META[d.type];
                  const Icon = meta?.icon ?? Sparkles;
                  return (
                    <TableRow key={`${d.type}-${d.start_window}-${i}`}>
                      <TableCell className="text-xs">
                        <span
                          className="inline-flex items-center gap-1.5 font-medium"
                          style={{ color: meta?.colour }}
                          title={meta?.explainer}
                        >
                          <Icon className="h-3 w-3" />
                          {meta?.label ?? d.type}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {fmtTs(d.start_timestamp)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-muted-foreground">
                        {fmtTs(d.end_timestamp)}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {(d.confidence * 100).toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function fmtTs(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
