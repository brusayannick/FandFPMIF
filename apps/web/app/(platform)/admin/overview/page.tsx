"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Briefcase,
  Database,
  FileStack,
  MousePointerClick,
  ShieldAlert,
  Users,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { rawFetch } from "@/lib/api";
import { formatNumber } from "@/lib/format";

interface DayCount {
  day: string;
  count: number;
}
interface LabelCount {
  label: string;
  count: number;
}
interface TopUser {
  user_id: string;
  email: string | null;
  username: string | null;
  count: number;
}
interface Kpis {
  user_count: number;
  log_count: number;
  events_ingested: number;
  cases_total: number;
  analytics_events: number;
  sessions_total: number;
  active_users_30d: number;
}
interface Overview {
  days: number;
  kpis: Kpis;
  signups_by_day: DayCount[];
  logs_by_day: DayCount[];
  logs_by_status: LabelCount[];
  logs_by_format: LabelCount[];
  logs_by_model: LabelCount[];
  top_users: TopUser[];
  jobs_by_status: LabelCount[];
  job_failures_by_day: DayCount[];
  sessions_by_day: DayCount[];
  top_event_types: LabelCount[];
}

const RANGES = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "12 months" },
];

/** "2026-06-17" → "06-17" for compact day-series axis ticks. */
function shortDay(day: string): string {
  return day.length >= 10 ? day.slice(5) : day;
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [days, setDays] = useState(90);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    void (async () => {
      try {
        const res = await rawFetch(`/api/v1/admin/insights/overview?days=${days}`);
        if (res.status === 403) {
          if (!cancelled) setState("forbidden");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Overview;
        if (!cancelled) {
          setData(json);
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Admin overview</h1>
        <p className="text-sm text-muted-foreground">
          Platform-wide activity across every user — accounts, imported logs, job
          health, and usage.
        </p>
      </div>

      <AdminTabs />

      {state === "forbidden" ? (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This dashboard requires the <code>admin</code> role. Ask an
            administrator to grant it in Keycloak (Realm roles → admin).
          </span>
        </div>
      ) : state === "error" ? (
        <p className="text-xs text-destructive">Failed to load admin overview.</p>
      ) : state === "loading" || data === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="flex items-center justify-end gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="range">
              Range
            </label>
            <select
              id="range"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="cursor-pointer rounded-md border border-border bg-surface px-2 py-1 text-xs"
            >
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Users" value={data.kpis.user_count} />
            <Kpi label="Event logs" value={data.kpis.log_count} />
            <Kpi label="Events ingested" value={data.kpis.events_ingested} />
            <Kpi label="Cases" value={data.kpis.cases_total} />
            <Kpi label="Active users (30d)" value={data.kpis.active_users_30d} />
            <Kpi label="Sessions" value={data.kpis.sessions_total} />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard title="New users" icon={Users} empty={data.signups_by_day.length === 0}>
              <DayLineChart data={data.signups_by_day} />
            </ChartCard>
            <ChartCard title="Logs imported" icon={FileStack} empty={data.logs_by_day.length === 0}>
              <DayLineChart data={data.logs_by_day} />
            </ChartCard>

            <ChartCard
              title="Logs by status"
              icon={Database}
              empty={data.logs_by_status.length === 0}
            >
              <LabelBarChart data={data.logs_by_status} />
            </ChartCard>
            <ChartCard
              title="Logs by source format"
              icon={Database}
              empty={data.logs_by_format.length === 0}
            >
              <LabelBarChart data={data.logs_by_format} />
            </ChartCard>

            <ChartCard
              title="Top users by log count"
              icon={Users}
              empty={data.top_users.length === 0}
            >
              <LabelBarChart
                data={data.top_users.map((u) => ({
                  label: u.username || u.email || u.user_id.slice(0, 8),
                  count: u.count,
                }))}
                horizontal
              />
            </ChartCard>
            <ChartCard
              title="Jobs by status"
              icon={Briefcase}
              empty={data.jobs_by_status.length === 0}
            >
              <LabelBarChart data={data.jobs_by_status} />
            </ChartCard>

            <ChartCard
              title="Failed jobs"
              icon={Briefcase}
              empty={data.job_failures_by_day.length === 0}
            >
              <DayLineChart data={data.job_failures_by_day} />
            </ChartCard>
            <ChartCard
              title="Sessions"
              icon={Activity}
              empty={data.sessions_by_day.length === 0}
            >
              <DayLineChart data={data.sessions_by_day} />
            </ChartCard>

            <ChartCard
              title="Top usage events"
              icon={MousePointerClick}
              empty={data.top_event_types.length === 0}
            >
              <LabelBarChart data={data.top_event_types} horizontal />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{formatNumber(value)}</div>
    </div>
  );
}

function ChartCard({
  title,
  icon: Icon,
  empty,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-12 text-center text-xs text-muted-foreground">No data yet.</p>
        ) : (
          <div className="h-48 w-full">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function DayLineChart({ data }: { data: DayCount[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="day"
          tickFormatter={shortDay}
          tick={{ fontSize: 10 }}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={28} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="count"
          stroke="currentColor"
          className="text-primary"
          dot={false}
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function LabelBarChart({ data, horizontal }: { data: LabelCount[]; horizontal?: boolean }) {
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 10 }}
            width={96}
            interval={0}
          />
          <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ fill: "transparent" }} />
          <Bar dataKey="count" fill="currentColor" className="text-primary" radius={[0, 2, 2, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={28} />
        <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ fill: "transparent" }} />
        <Bar dataKey="count" fill="currentColor" className="text-primary" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
