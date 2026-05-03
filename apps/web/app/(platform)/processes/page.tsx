"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Inbox, Plug, Plus, Upload, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ProcessesTable } from "@/components/processes/processes-table";
import { useEventLogs } from "@/lib/queries";

export default function ProcessesPage() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-8">
      <Header />
      <Suspense fallback={<ListSkeleton />}>
        <ProcessList />
      </Suspense>
    </section>
  );
}

function Header() {
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

        <Button asChild className="gap-2 cursor-pointer">
          <Link href="/processes/import">
            <Upload className="h-4 w-4" />
            Import event log
          </Link>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="cursor-pointer"
              aria-label="More import options"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled className="cursor-not-allowed">
              Import from URL
            </DropdownMenuItem>
            <DropdownMenuItem disabled className="cursor-not-allowed">
              Import demo log
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-[var(--row-height)] w-full" />
      ))}
    </div>
  );
}

function ProcessList() {
  const sp = useSearchParams();
  const q = sp.get("q") ?? undefined;
  const status = sp.get("status") ?? undefined;
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
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <ProcessesTable rows={data} />
    </div>
  );
}
