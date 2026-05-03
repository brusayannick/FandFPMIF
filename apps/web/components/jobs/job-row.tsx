"use client";

import { useState } from "react";
import {
  Copy,
  ExternalLink,
  Info,
  Loader2,
  RefreshCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { useCancelJob, useRetryJob } from "@/lib/queries";
import { formatDuration, formatNumber, formatRelative } from "@/lib/format";
import type { LiveJob } from "@/lib/stores/jobs";

interface JobRowProps {
  job: LiveJob;
  onOpenResult?: (job: LiveJob) => void;
}

export function JobRow({ job, onOpenResult }: JobRowProps) {
  const cancel = useCancelJob();
  const retry = useRetryJob();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const total = job.progress_total ?? null;
  const pct =
    total && total > 0
      ? Math.min(100, Math.max(0, Math.floor((job.progress_current / total) * 100)))
      : null;
  const eta = job.eta_seconds ?? job.eta_local ?? null;
  const rate = job.rate ?? job.rate_local ?? null;

  const isActive = job.status === "running" || job.status === "queued" || job.status === "paused";
  const isFailed = job.status === "failed";
  const isCompleted = job.status === "completed";

  const subtitle = job.subtitle ?? `${job.type}${job.module_id ? ` · ${job.module_id}` : ""}`;

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{job.title}</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <StatusBadge status={job.status} />
      </div>

      <div className="space-y-1">
        <Progress
          value={pct ?? undefined}
          className={pct === null && isActive ? "h-1 animate-pulse" : "h-1"}
        />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>
            {pct === null
              ? job.progress_current
                ? `${formatNumber(job.progress_current)} processed`
                : "Estimating…"
              : `${formatNumber(job.progress_current)} / ${formatNumber(total)} (${pct}%)`}
          </span>
          <span>
            {rate && Number.isFinite(rate)
              ? `${Math.round(rate).toLocaleString()}/s · ETA ${formatDuration(eta)}`
              : "—"}
          </span>
        </div>
      </div>

      {(job.stage || job.message) && (
        <p className="text-[11px] text-muted-foreground">
          {job.stage && <span className="font-medium uppercase tracking-wide">{job.stage}</span>}
          {job.stage && job.message && <span className="mx-1">·</span>}
          {job.message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
        <span>
          {job.started_at ? `Started ${formatRelative(job.started_at)}` : `Created ${formatRelative(job.created_at)}`}
        </span>
        <div className="flex items-center gap-1">
          {isActive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 cursor-pointer gap-1 text-xs"
              onClick={() => cancel.mutate(job.id)}
              disabled={cancel.isPending}
            >
              <X className="h-3 w-3" />
              Cancel
            </Button>
          )}
          {isFailed && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 cursor-pointer gap-1 text-xs"
              onClick={() => retry.mutate(job.id)}
              disabled={retry.isPending}
            >
              <RefreshCcw className="h-3 w-3" />
              Retry
            </Button>
          )}
          {isCompleted && onOpenResult && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 cursor-pointer gap-1 text-xs"
              onClick={() => onOpenResult(job)}
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 cursor-pointer gap-1 text-xs"
            onClick={() => {
              navigator.clipboard.writeText(job.id);
              toast.success("Job id copied");
            }}
          >
            <Copy className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 cursor-pointer gap-1 text-xs"
            onClick={() => setDetailsOpen(true)}
          >
            <Info className="h-3 w-3" />
            Details
          </Button>
          {isActive && cancel.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
        </div>
      </div>

      <JobDetailsDialog job={job} open={detailsOpen} onOpenChange={setDetailsOpen} />
    </Card>
  );
}

function JobDetailsDialog({
  job,
  open,
  onOpenChange,
}: {
  job: LiveJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const subtitle = job.subtitle ?? `${job.type}${job.module_id ? ` · ${job.module_id}` : ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle className="truncate">{job.title}</DialogTitle>
              <DialogDescription className="truncate">{subtitle}</DialogDescription>
            </div>
            <StatusBadge status={job.status} />
          </div>
        </DialogHeader>

        <div className="-mr-2 max-h-[60vh] space-y-4 overflow-y-auto pr-2">
          <DetailGrid job={job} />

          {(job.stage || job.message) && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Status
              </div>
              <p className="text-xs">
                {job.stage && (
                  <span className="font-medium uppercase tracking-wide">{job.stage}</span>
                )}
                {job.stage && job.message && <span className="mx-1">·</span>}
                {job.message}
              </p>
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Payload
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 cursor-pointer gap-1 text-[11px]"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(job.payload_json, null, 2));
                  toast.success("Payload copied");
                }}
              >
                <Copy className="h-3 w-3" />
                Copy
              </Button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-[11px]">
              {JSON.stringify(job.payload_json, null, 2)}
            </pre>
          </div>

          {job.error && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-destructive">Error</div>
              <pre className="max-h-64 overflow-auto rounded-md bg-destructive/10 p-3 text-[11px] text-destructive">
                {job.error}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailGrid({ job }: { job: LiveJob }) {
  const total = job.progress_total ?? null;
  const pct =
    total && total > 0
      ? Math.min(100, Math.max(0, Math.floor((job.progress_current / total) * 100)))
      : null;
  const eta = job.eta_seconds ?? job.eta_local ?? null;
  const rate = job.rate ?? job.rate_local ?? null;

  const items: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "Job id",
      value: (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(job.id);
            toast.success("Job id copied");
          }}
          className="cursor-pointer truncate font-mono text-xs hover:underline"
          title={job.id}
        >
          {job.id}
        </button>
      ),
    },
    { label: "Type", value: <span className="truncate font-mono text-xs">{job.type}</span> },
    {
      label: "Module",
      value: (
        <span className="truncate font-mono text-xs">{job.module_id ?? "—"}</span>
      ),
    },
    { label: "Priority", value: <span className="tabular-nums">{job.priority}</span> },
    {
      label: "Progress",
      value: (
        <span className="tabular-nums">
          {pct === null
            ? job.progress_current
              ? `${formatNumber(job.progress_current)} processed`
              : "—"
            : `${formatNumber(job.progress_current)} / ${formatNumber(total)} (${pct}%)`}
        </span>
      ),
    },
    {
      label: "Rate · ETA",
      value: (
        <span className="tabular-nums">
          {rate && Number.isFinite(rate)
            ? `${Math.round(rate).toLocaleString()}/s · ETA ${formatDuration(eta)}`
            : "—"}
        </span>
      ),
    },
    {
      label: "Created",
      value: <span>{formatRelative(job.created_at)}</span>,
    },
    {
      label: "Started",
      value: <span>{job.started_at ? formatRelative(job.started_at) : "—"}</span>,
    },
    {
      label: "Finished",
      value: <span>{job.finished_at ? formatRelative(job.finished_at) : "—"}</span>,
    },
    {
      label: "Parent",
      value: (
        <span className="truncate font-mono text-xs">{job.parent_job_id ?? "—"}</span>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
      {items.map((it) => (
        <div key={it.label} className="min-w-0 space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {it.label}
          </div>
          <div className="min-w-0 truncate">{it.value}</div>
        </div>
      ))}
    </div>
  );
}
