"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import type { PerActivityDeviation, PerVariant, Technique } from "./types";

export function DeviationTable({
  perActivity,
  perVariant,
  technique,
}: {
  perActivity: PerActivityDeviation[];
  perVariant: PerVariant[];
  technique: Technique;
}) {
  const alignments = technique === "alignments";
  return (
    <Tabs defaultValue="activity" className="space-y-3">
      <TabsList>
        <TabsTrigger value="activity">By activity</TabsTrigger>
        <TabsTrigger value="variant">By variant</TabsTrigger>
      </TabsList>
      <TabsContent value="activity">
        <ActivityTable rows={perActivity} alignments={alignments} />
      </TabsContent>
      <TabsContent value="variant">
        <VariantTable rows={perVariant} />
      </TabsContent>
    </Tabs>
  );
}

function ActivityTable({
  rows,
  alignments,
}: {
  rows: PerActivityDeviation[];
  alignments: boolean;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.deviations), 0);
  if (rows.length === 0) {
    return <Empty>No activities to show.</Empty>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Activity</th>
            <th className="px-3 py-2 text-right font-medium">Deviations</th>
            {alignments ? (
              <>
                <th className="px-3 py-2 text-right font-medium">Log moves</th>
                <th className="px-3 py-2 text-right font-medium">Model moves</th>
              </>
            ) : null}
            <th className="px-3 py-2 text-right font-medium">Cases</th>
            <th className="w-40 px-3 py-2 font-medium">Severity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.activity} className="border-b border-border last:border-0 hover:bg-muted/30">
              <td className="px-3 py-2">
                <span className="font-mono text-xs">{r.activity}</span>
                {!r.matched ? (
                  <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-500">
                    no log match
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.deviations)}</td>
              {alignments ? (
                <>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(r.log_moves)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatNumber(r.model_moves)}
                  </td>
                </>
              ) : null}
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatNumber(r.cases_affected)}
              </td>
              <td className="px-3 py-2">
                <SeverityBar value={r.deviations} max={max} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VariantTable({ rows }: { rows: PerVariant[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (rows.length === 0) {
    return <Empty>No variants to show.</Empty>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Variant</th>
            <th className="px-3 py-2 text-right font-medium">Cases</th>
            <th className="px-3 py-2 text-right font-medium">Avg fitness</th>
            <th className="px-3 py-2 text-right font-medium">Deviations</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isOpen = open.has(r.variant_id);
            return (
              <Fragment key={r.variant_id}>
                <tr
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                  onClick={() => toggle(r.variant_id)}
                >
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="font-medium">Variant {i + 1}</span>
                      <span className="text-xs text-muted-foreground">
                        · {r.activities.length} steps
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.n_cases)}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      r.avg_fitness >= 1 ? "text-emerald-600 dark:text-emerald-500" : "text-foreground",
                    )}
                  >
                    {r.avg_fitness.toFixed(3)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.deviations)}</td>
                </tr>
                {isOpen ? (
                  <tr className="border-b border-border bg-muted/20 last:border-0">
                    <td colSpan={4} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {r.activities.map((a, idx) => (
                          <Fragment key={`${r.variant_id}-${idx}`}>
                            {idx > 0 ? (
                              <span className="text-muted-foreground/60">→</span>
                            ) : null}
                            <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px]">
                              {a}
                            </code>
                          </Fragment>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SeverityBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-red-500/70"
        style={{ width: `${pct}%` }}
        aria-hidden
      />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border px-3 py-8 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}
