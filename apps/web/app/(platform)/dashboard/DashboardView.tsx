"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import {
  dashboardStatsSchema,
  activityFeedSchema,
} from "@/lib/schemas/dashboard";
import { processSummarySchema } from "@/lib/schemas/graph";
import { formatDuration, formatNumber } from "@/lib/utils";
import { relativeTime } from "@/lib/time";
import { z } from "zod";

function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const data = await api.get("/dashboard/stats");
      return dashboardStatsSchema.parse(data);
    },
  });
}

function useRecentProcesses() {
  return useQuery({
    queryKey: ["processes", "recent"],
    queryFn: async () => {
      const data = await api.get("/processes");
      return z.array(processSummarySchema).parse(data);
    },
  });
}

function useActivity() {
  return useQuery({
    queryKey: ["dashboard", "activity"],
    queryFn: async () => {
      const data = await api.get("/dashboard/activity");
      return activityFeedSchema.parse(data);
    },
  });
}

function formatKpiValue(
  value: number,
  unit: string | null | undefined,
): string {
  if (unit === "ms") return formatDuration(value);
  return formatNumber(value);
}

export function DashboardView() {
  const stats = useDashboardStats();
  const processes = useRecentProcesses();
  const activity = useActivity();

  const anyError = stats.isError || processes.isError || activity.isError;

  return (
    <div className="space-y-6">
      {anyError && (
        <Card className="border-error/30 bg-error/10">
          <CardContent className="flex items-start gap-2 py-3 text-sm text-error">
            <AlertCircle size={16} className="mt-0.5" />
            <div>
              <div className="font-medium">Backend unavailable</div>
              <div className="text-xs">
                Start the API server with{" "}
                <code className="rounded bg-surface-2 px-1 py-0.5">
                  uv run uvicorn main:app --reload
                </code>
                .
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <section
        aria-label="Key performance indicators"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {stats.isLoading || !stats.data
          ? Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
          : stats.data.cards.map((card) => (
              <Card key={card.label} className="bg-surface">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-normal text-text-muted">
                    {card.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold tabular-nums">
                    {formatKpiValue(card.value, card.unit)}
                  </div>
                  {card.delta_percent != null && (
                    <div
                      className={
                        "mt-1 text-xs " +
                        (card.delta_percent > 0
                          ? "text-success"
                          : card.delta_percent < 0
                            ? "text-error"
                            : "text-text-faint")
                      }
                    >
                      {card.delta_percent > 0 ? "+" : ""}
                      {card.delta_percent}% vs last week
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="bg-surface lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent Processes</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/processes">
                View all <ArrowRight size={12} />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {processes.isLoading ? (
              <ul className="divide-y">
                {Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-12" />
                  </li>
                ))}
              </ul>
            ) : processes.data && processes.data.length > 0 ? (
              <div className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b bg-surface-2">
                    <tr className="text-left text-[10px] font-medium uppercase tracking-wider text-text-faint">
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2">Updated</th>
                      <th className="px-4 py-2 text-right">Nodes</th>
                      <th className="px-4 py-2 text-right">Edges</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {processes.data.slice(0, 8).map((p) => (
                      <tr
                        key={p.id}
                        className="border-b last:border-b-0 hover:bg-surface-offset"
                      >
                        <td className="px-4 py-2">
                          <Link
                            href={`/processes/${p.id}`}
                            className="hover:text-primary"
                          >
                            {p.name}
                          </Link>
                          {p.description && (
                            <div className="truncate text-[11px] text-text-muted">
                              {p.description}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-text-muted">
                          {relativeTime(p.updated_at)}
                        </td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums text-text-muted">
                          {p.node_count}
                        </td>
                        <td className="px-4 py-2 text-right text-xs tabular-nums text-text-muted">
                          {p.edge_count}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/processes/${p.id}`}>Open</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No processes yet"
                body="Create your first process to start modelling."
                action={
                  <Button size="sm" asChild>
                    <Link href="/processes/demo">
                      <Plus size={14} /> Open demo canvas
                    </Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader>
            <CardTitle className="text-base">Module Activity</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {activity.isLoading ? (
              <ul className="space-y-3 px-6 pb-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <Skeleton className="h-2 w-2 rounded-full" />
                    <Skeleton className="h-3 flex-1" />
                  </li>
                ))}
              </ul>
            ) : activity.data && activity.data.items.length > 0 ? (
              <ol className="space-y-0">
                {activity.data.items.map((item, i) => (
                  <li
                    key={item.id + i}
                    className="flex items-start gap-3 px-6 py-3 text-sm hover:bg-surface-offset"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{item.title}</div>
                      {item.subtitle && (
                        <div className="truncate text-[11px] text-text-muted">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-[11px] text-text-faint">
                      {relativeTime(item.timestamp)}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="No activity yet"
                body="Module runs and graph updates will appear here."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiSkeleton() {
  return (
    <Card className="bg-surface">
      <CardHeader className="pb-2">
        <Skeleton className="h-3 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-20" />
      </CardContent>
    </Card>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="text-sm">{title}</div>
      <p className="max-w-[260px] text-xs text-text-muted">{body}</p>
      {action}
    </div>
  );
}
