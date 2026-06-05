"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Download,
  Eye,
  LayoutDashboard,
  Loader2,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { CardPalette } from "@/components/dashboards/card-palette";
import { DashboardCanvas } from "@/components/dashboards/dashboard-canvas";
import {
  DashboardFilterProvider,
  DashboardWidgetScope,
  useDashboardFilter,
} from "@/components/dashboards/dashboard-filter";
import { DashboardFilterBar } from "@/components/dashboards/dashboard-filter-bar";
import { DashboardTimeRange } from "@/components/dashboards/dashboard-time-range";
import { useEventLogs } from "@/lib/queries";
import {
  configDefaults,
  useDashboard,
  useEventColumns,
  useTimeBounds,
  useUpdateDashboard,
  type DashboardCard as CatalogCard,
  type DashboardItem,
} from "@/lib/dashboard-queries";

const COLS = 12;

export function DashboardView({ dashboardId }: { dashboardId: string }) {
  const { data: dashboard, isLoading, isError } = useDashboard(dashboardId);
  const { data: logs } = useEventLogs({ status: "ready" });
  const update = useUpdateDashboard(dashboardId);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [items, setItems] = useState<DashboardItem[]>([]);
  const [logId, setLogId] = useState<string | null>(null);
  const [pendingCard, setPendingCard] = useState<CatalogCard | null>(null);
  // Snapshot of the last-saved state, to compute the dirty flag.
  const savedRef = useRef<string>("");

  // Hydrate local edit state once the dashboard loads (and after each save).
  useEffect(() => {
    if (!dashboard) return;
    setName(dashboard.name);
    setItems(dashboard.items);
    setLogId(dashboard.event_log_id);
    savedRef.current = JSON.stringify({
      name: dashboard.name,
      items: dashboard.items,
      event_log_id: dashboard.event_log_id,
    });
  }, [dashboard]);

  const dirty = useMemo(
    () =>
      savedRef.current !== JSON.stringify({ name, items, event_log_id: logId }),
    [name, items, logId],
  );

  const readyLogs = useMemo(
    () => (logs ?? []).filter((l) => l.status === "ready"),
    [logs],
  );

  const save = async () => {
    try {
      await update.mutateAsync({ name: name.trim() || "Untitled", items, event_log_id: logId });
      savedRef.current = JSON.stringify({ name, items, event_log_id: logId });
      toast.success("Dashboard saved");
    } catch {
      toast.error("Could not save dashboard");
    }
  };

  const exportJson = () => {
    const doc = {
      kind: "mate.dashboard",
      version: 1,
      name,
      description: dashboard?.description ?? null,
      items,
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name || "dashboard").replace(/[^\w.-]+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Append via click-to-add: drop the card at the bottom of the board.
  const addCard = (card: CatalogCard) => {
    const maxY = items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `card-${Date.now()}`;
    setItems((prev) => [
      ...prev,
      {
        i: id,
        module_id: card.module_id,
        widget_id: card.widget_id,
        title: card.title,
        x: 0,
        y: maxY,
        w: Math.min(card.default_w, COLS),
        h: card.default_h,
        config: configDefaults(card.config_schema),
      },
    ]);
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }
  if (isError || !dashboard) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title="Dashboard not found"
        description="It may have been deleted."
        primaryAction={
          <Button asChild variant="outline">
            <Link href="/dashboards">Back to dashboards</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8" aria-label="Back">
          <Link href="/dashboards">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>

        {editing ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 w-56 text-sm font-medium"
            placeholder="Dashboard name"
            aria-label="Dashboard name"
          />
        ) : (
          <h1 className="truncate text-sm font-semibold tracking-tight">{name}</h1>
        )}

        <div className="ml-2 flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Log</span>
          <Select
            value={logId ?? "__none__"}
            onValueChange={(v) => setLogId(v === "__none__" ? null : v)}
          >
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="Select event log" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No log selected</SelectItem>
              {readyLogs.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={exportJson}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export
          </Button>
          {editing ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                View
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={!dirty || update.isPending}
              >
                {update.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Body: global filter bar + (palette + canvas) + time range. The filter
          provider scopes every widget's queries so a filter change skeletons
          and refetches them all without touching the rest of the app. */}
      <DashboardFilterProvider>
        <div className="flex min-h-0 flex-1 flex-col">
          {logId && <DashboardFilterBarConnected logId={logId} />}
          <div className="flex min-h-0 flex-1">
            {editing && <CardPalette onPickCard={addCard} onDragCard={setPendingCard} />}
            <DashboardWidgetScope>
              <div className="dashboard-canvas-bg min-h-0 flex-1 overflow-auto p-3">
                {items.length === 0 ? (
                  <EmptyState
                    icon={LayoutDashboard}
                    title={editing ? "Empty board" : "No cards yet"}
                    description={
                      editing
                        ? "Drag a card from the left, or click one to add it."
                        : "Switch to edit mode to add cards from your modules."
                    }
                    primaryAction={
                      !editing ? (
                        <Button size="sm" onClick={() => setEditing(true)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" />
                          Edit dashboard
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <DashboardCanvas
                    items={items}
                    logId={logId}
                    editing={editing}
                    pendingCard={pendingCard}
                    onItemsChange={setItems}
                  />
                )}
              </div>
            </DashboardWidgetScope>
          </div>
          {logId && <DashboardTimeRangeConnected logId={logId} />}
        </div>
      </DashboardFilterProvider>
    </div>
  );
}

/** Binds the column-filter bar to the bound log's columns + the dashboard's
 * ephemeral filter state. Its own data (column specs) is fetched on the app's
 * QueryClient, so a filter commit doesn't churn it. */
function DashboardFilterBarConnected({ logId }: { logId: string }) {
  const { columnFilters, setColumnFilters } = useDashboardFilter();
  const { data: columns } = useEventColumns(logId);
  if (!columns || columns.length === 0) return null;
  return (
    <DashboardFilterBar
      logId={logId}
      columns={columns}
      filters={columnFilters}
      onChange={setColumnFilters}
    />
  );
}

function DashboardTimeRangeConnected({ logId }: { logId: string }) {
  const { setTimeFilters } = useDashboardFilter();
  const { data: bounds } = useTimeBounds(logId);
  return <DashboardTimeRange bounds={bounds} onChange={setTimeFilters} />;
}
