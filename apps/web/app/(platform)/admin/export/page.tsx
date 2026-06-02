"use client";

import { useEffect, useState } from "react";
import { Database, Download, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rawFetch } from "@/lib/api";

interface ExportInfo {
  is_admin: boolean;
  user_count: number | null;
  db_size_bytes: number | null;
}

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

function timestampedName(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `metadata-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours(),
  )}${p(d.getMinutes())}${p(d.getSeconds())}.db`;
}

export default function AdminExportPage() {
  const [info, setInfo] = useState<ExportInfo | null>(null);
  const [downloading, setDownloading] = useState(false);

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
        if (!cancelled) setInfo({ is_admin: false, user_count: null, db_size_bytes: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onDownload() {
    setDownloading(true);
    try {
      const res = await rawFetch("/api/v1/admin/export/metadata-db");
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
      a.download = timestampedName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }

  const loading = info === null;
  const isAdmin = info?.is_admin === true;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Data export</h1>
        <p className="text-sm text-muted-foreground">
          Download a consistent snapshot of the entire metadata database.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Full metadata database
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            The downloaded <code>.db</code> file is a SQLite snapshot containing{" "}
            <strong>every user&apos;s data</strong> — accounts, usage analytics,
            process metadata, and settings. Handle it accordingly. The snapshot
            is taken live and is transactionally consistent.
          </p>

          {!loading && isAdmin && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Users" value={info?.user_count ?? "—"} />
              <Stat label="Database size" value={formatBytes(info?.db_size_bytes ?? null)} />
            </div>
          )}

          {loading ? (
            <p className="text-xs text-muted-foreground">Checking access…</p>
          ) : isAdmin ? (
            <Button onClick={onDownload} disabled={downloading} className="cursor-pointer gap-1.5">
              <Download className="h-4 w-4" />
              {downloading ? "Preparing…" : "Download metadata database"}
            </Button>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This export requires the <code>admin</code> role. Ask an
                administrator to grant it in Keycloak (Realm roles → admin).
              </span>
            </div>
          )}
        </CardContent>
      </Card>
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
