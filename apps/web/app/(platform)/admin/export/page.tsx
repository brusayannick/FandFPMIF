"use client";

import { useEffect, useState } from "react";
import { Database, Download, Network, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { rawFetch } from "@/lib/api";

interface ExportInfo {
  is_admin: boolean;
  user_count: number | null;
  event_count: number | null;
  db_size_bytes: number | null;
}

type CaseNotion = "session" | "user";

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function tsName(base: string, ext: string): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${base}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours(),
  )}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

/** Fetch an authenticated download and save it client-side as `filename`. */
async function downloadBlob(path: string, filename: string): Promise<void> {
  const res = await rawFetch(path);
  if (res.status === 403) {
    toast.error("This export requires the admin role.");
    return;
  }
  if (!res.ok) {
    toast.error(`Export failed (${res.status}).`);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdminExportPage() {
  const [info, setInfo] = useState<ExportInfo | null>(null);
  const [dbBusy, setDbBusy] = useState(false);
  const [xesBusy, setXesBusy] = useState(false);
  const [caseNotion, setCaseNotion] = useState<CaseNotion>("session");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await rawFetch("/api/v1/admin/export-info");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as ExportInfo;
        if (!cancelled) setInfo(data);
      } catch {
        // Treat any failure as "not permitted" rather than leaking detail.
        if (!cancelled)
          setInfo({ is_admin: false, user_count: null, event_count: null, db_size_bytes: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(fn: () => Promise<void>, setBusy: (b: boolean) => void) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const loading = info === null;
  const isAdmin = info?.is_admin === true;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Data export</h1>
        <p className="text-sm text-muted-foreground">
          Download the entire metadata database or every analytics event as an
          XES event log.
        </p>
      </div>

      <AdminTabs />

      {loading ? (
        <p className="text-xs text-muted-foreground">Checking access…</p>
      ) : !isAdmin ? (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            These exports require the <code>admin</code> role. Ask an
            administrator to grant it in Keycloak (Realm roles → admin).
          </span>
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" />
                Full metadata database
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                A SQLite snapshot containing <strong>every user&apos;s data</strong>{" "}
                - accounts, usage analytics, process metadata, and settings. Taken
                live and transactionally consistent.
              </p>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <Stat label="Users" value={info?.user_count ?? "—"} />
                <Stat label="Database size" value={formatBytes(info?.db_size_bytes ?? null)} />
              </div>

              <Button
                onClick={() =>
                  run(
                    () => downloadBlob("/api/v1/admin/export/metadata-db", tsName("metadata", "db")),
                    setDbBusy,
                  )
                }
                disabled={dbBusy}
                className="cursor-pointer gap-1.5"
              >
                <Download className="h-4 w-4" />
                {dbBusy ? "Preparing…" : "Download metadata database"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Network className="h-4 w-4" />
                Event log (XES)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Every analytics event across <strong>all users</strong> as a
                standard XES log for process mining - clicks, navigation,
                server-side operation timings, and job outcomes. Activity is the
                event name and the timestamp is when it occurred; the source,
                type, path, durations, and per-event details come through as XES
                attributes.
              </p>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <Stat label="Events" value={info?.event_count ?? "—"} />
                <Stat label="Users" value={info?.user_count ?? "—"} />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium" htmlFor="case-notion">
                  Case (trace)
                </label>
                <select
                  id="case-notion"
                  value={caseNotion}
                  onChange={(e) => setCaseNotion(e.target.value as CaseNotion)}
                  className="block w-full cursor-pointer rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                >
                  <option value="session">Session - one trace per visit</option>
                  <option value="user">User - one trace per person</option>
                </select>
              </div>

              <Button
                onClick={() =>
                  run(
                    () =>
                      downloadBlob(
                        `/api/v1/admin/export/event-log.xes?case=${caseNotion}`,
                        tsName("events", "xes"),
                      ),
                    setXesBusy,
                  )
                }
                disabled={xesBusy}
                className="cursor-pointer gap-1.5"
              >
                <Download className="h-4 w-4" />
                {xesBusy ? "Preparing…" : "Download XES event log"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
