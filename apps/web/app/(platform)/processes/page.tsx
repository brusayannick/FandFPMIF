"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FolderPlus, Inbox, Plug, Plus, RefreshCw, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  NewFolderDialog,
  ProcessesTable,
} from "@/components/processes/processes-table";
import { useEventLogs } from "@/lib/queries";
import type { LogModel } from "@/lib/api-types";

export default function ProcessesPage() {
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  return (
    <section className="mx-auto max-w-7xl px-6 py-8">
      <Header onNewFolder={() => setNewFolderOpen(true)} />
      <Suspense fallback={<ListSkeleton />}>
        <ProcessList />
      </Suspense>
      <NewFolderDialog open={newFolderOpen} onOpenChange={setNewFolderOpen} />
    </section>
  );
}

function Header({ onNewFolder }: { onNewFolder: () => void }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Processes</h1>
        <p className="text-sm text-muted-foreground">
          Imported event logs. Drop a XES, XES.gz, or CSV here to start mining.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Button
                variant="outline"
                className="gap-2 cursor-not-allowed"
                disabled
                aria-disabled
              >
                <Plug className="h-4 w-4" />
                Connect to system
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  Coming soon
                </Badge>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            Connect directly to ERP / CRM systems (SAP, Salesforce, Dynamics, …)
            to stream events without manual export.
          </TooltipContent>
        </Tooltip>

        <Button variant="outline" asChild className="gap-2 cursor-pointer">
          <Link href="/processes/watched">
            <RefreshCw className="h-4 w-4" />
            Watched folders
          </Link>
        </Button>

        <Button variant="outline" onClick={onNewFolder} className="gap-2 cursor-pointer">
          <FolderPlus className="h-4 w-4" />
          New folder
        </Button>

        <Button asChild className="gap-2 cursor-pointer">
          <Link href="/processes/import">
            <Upload className="h-4 w-4" />
            Import event log
          </Link>
        </Button>
      </div>
    </header>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

type ModelFilter = "all" | LogModel;

const MODEL_FILTERS: { value: ModelFilter; label: string }[] = [
  { value: "all", label: "All processes" },
  { value: "case_centric", label: "Case-centric" },
  { value: "object_centric", label: "Object-centric" },
];

function ProcessList() {
  const sp = useSearchParams();
  const q = sp.get("q") ?? undefined;
  const status = sp.get("status") ?? undefined;
  const [model, setModel] = useState<ModelFilter>("all");
  const { data, isLoading, isError, error } = useEventLogs({ q, status });

  if (isLoading) return <ListSkeleton />;
  if (isError) {
    return (
      <EmptyState
        icon={Inbox}
        title="Couldn't load processes"
        description={(error as Error)?.message ?? "Unknown error"}
      />
    );
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Import your first event log"
        description="Drop a XES, XES.gz, or CSV to start. The platform stores it as Parquet so analytics modules can query it in milliseconds."
        primaryAction={
          <Button asChild className="cursor-pointer">
            <Link href="/processes/import" className="gap-2">
              <Upload className="h-4 w-4" />
              Import event log
            </Link>
          </Button>
        }
        secondaryAction={
          <Button variant="outline" disabled className="gap-2 cursor-not-allowed">
            <Plus className="h-4 w-4" />
            Try with sample data
          </Button>
        }
      />
    );
  }

  const rows = model === "all" ? data : data.filter((l) => l.log_model === model);

  return (
    <div className="space-y-3">
      <ButtonGroup>
        {MODEL_FILTERS.map(({ value, label }) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={model === value ? "default" : "outline"}
            aria-pressed={model === value}
            className="cursor-pointer"
            onClick={() => setModel(value)}
          >
            {label}
          </Button>
        ))}
      </ButtonGroup>
      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No matching processes"
          description={`No ${
            model === "case_centric" ? "case-centric" : "object-centric"
          } logs yet. Switch to “All processes” to see everything.`}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <ProcessesTable rows={rows} />
        </div>
      )}
    </div>
  );
}
