"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Inbox, Loader2 } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { ModuleGrid } from "@/components/processes/module-grid";
import { EventsTab } from "@/components/processes/events-tab";
import { VariantsTab } from "@/components/processes/variants-tab";
import { ActivitiesTab } from "@/components/processes/activities-tab";
import { SettingsTab } from "@/components/processes/settings-tab";
import { useEventLog } from "@/lib/queries";
import { formatDateRange, formatNumber, formatRelative } from "@/lib/format";

type TabId = "overview" | "events" | "variants" | "activities" | "settings";

const TAB_IDS: readonly TabId[] = ["overview", "events", "variants", "activities", "settings"];

function readTab(value: string | null | undefined): TabId {
  return TAB_IDS.includes(value as TabId) ? (value as TabId) : "overview";
}

export default function ProcessDetailPage() {
  const params = useParams<{ logId: string }>();
  const logId = params.logId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = readTab(searchParams.get("tab"));
  const { data: log, isLoading, isError, error } = useEventLog(logId);

  const setTab = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === "overview") sp.delete("tab");
      else sp.set("tab", next);
      // Cross-tab filter params should reset when the user clicks a different tab.
      if (next !== "events") {
        sp.delete("case_id");
        sp.delete("missing_only");
      }
      const query = sp.toString();
      router.replace(query ? `?${query}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !log) {
    return (
      <EmptyState
        icon={Inbox}
        title="Process not found"
        description={(error as Error)?.message ?? "It may have been deleted."}
      />
    );
  }

  const importing = log.status === "importing";
  const failed = log.status === "failed";
  const ready = log.status === "ready";

  return (
    <section className="mx-auto max-w-7xl px-6 py-8">
      <header className="space-y-3 pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{log.name}</h1>
          <StatusBadge status={log.status} />
          {log.source_format && (
            <Badge variant="outline" className="border-0 bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
              {log.source_format}
            </Badge>
          )}
          {log.last_edited_at && (
            <Badge variant="outline" className="border-0 bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
              edited {formatRelative(log.last_edited_at)}
            </Badge>
          )}
        </div>
        {log.description && (
          <p className="text-sm text-muted-foreground max-w-3xl">{log.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span><span className="tabular-nums">{formatNumber(log.cases_count)}</span> cases</span>
          <span><span className="tabular-nums">{formatNumber(log.events_count)}</span> events</span>
          <span><span className="tabular-nums">{formatNumber(log.variants_count)}</span> variants</span>
          <span>{formatDateRange(log.date_min, log.date_max)}</span>
        </div>
      </header>

      {importing && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Import is still in progress. Modules become available once it finishes.
        </div>
      )}
      {failed && (
        <div className="mb-6 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Import failed: {log.error ?? "Unknown error"}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview" className="cursor-pointer">Overview</TabsTrigger>
          <TabsTrigger value="events" className="cursor-pointer" disabled={!ready}>Events</TabsTrigger>
          <TabsTrigger value="variants" className="cursor-pointer" disabled={!ready}>Variants</TabsTrigger>
          <TabsTrigger value="activities" className="cursor-pointer" disabled={!ready}>Activities</TabsTrigger>
          <TabsTrigger value="settings" className="cursor-pointer">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-6">
          <ModuleGrid logId={logId} />
          <p className="mt-6 text-xs text-muted-foreground">
            Need a module that isn&apos;t installed?{" "}
            <Link href="/settings/modules/import" className="underline-offset-4 hover:underline">
              Install one →
            </Link>
          </p>
        </TabsContent>
        <TabsContent value="events" className="pt-6">
          {ready && <EventsTab logId={logId} log={log} />}
        </TabsContent>
        <TabsContent value="variants" className="pt-6">
          {ready && <VariantsTab logId={logId} log={log} />}
        </TabsContent>
        <TabsContent value="activities" className="pt-6">
          {ready && <ActivitiesTab logId={logId} log={log} />}
        </TabsContent>
        <TabsContent value="settings" className="pt-6">
          <SettingsTab logId={logId} log={log} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
