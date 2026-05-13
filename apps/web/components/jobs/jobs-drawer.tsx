"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Inbox, MoreHorizontal, Pause, Play, Trash2, Eye } from "lucide-react";
import { toastError } from "@/lib/toast";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/empty-state";
import { JobRow } from "@/components/jobs/job-row";
import { api } from "@/lib/api";
import {
  selectActiveJobs,
  selectCounts,
  selectFinishedJobs,
  useJobsStore,
  type LiveJob,
} from "@/lib/stores/jobs";

type Filter = "all" | "running" | "queued" | "finished";

export function JobsDrawer() {
  const open = useJobsStore((s) => s.drawerOpen);
  const setOpen = useJobsStore((s) => s.setDrawerOpen);
  const paused = useJobsStore((s) => s.paused);
  const finishedHidden = useJobsStore((s) => s.finishedHidden);
  const active = useJobsStore(useShallow(selectActiveJobs));
  const finished = useJobsStore(useShallow(selectFinishedJobs));
  const clearFinished = useJobsStore((s) => s.clearFinished);
  const setFinishedHidden = useJobsStore((s) => s.setFinishedHidden);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  // `j j` chord opens the drawer.
  useEffect(() => {
    let lastJ = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      }
      if (e.key.toLowerCase() === "j") {
        const now = Date.now();
        if (now - lastJ < 700) {
          setOpen(true);
          lastJ = 0;
        } else {
          lastJ = now;
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const ordered = useMemo(() => {
    let rows: LiveJob[] = [];
    if (filter === "all") {
      rows = [...active, ...finished];
    } else if (filter === "running") {
      rows = active.filter((j) => j.status === "running");
    } else if (filter === "queued") {
      rows = active.filter((j) => j.status === "queued" || j.status === "paused");
    } else {
      rows = finished;
    }
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (r) => r.title.toLowerCase().includes(needle) || r.id.includes(needle),
      );
    }
    return rows;
  }, [active, finished, filter, q]);


  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="flex w-[420px] flex-col gap-0 p-0 sm:max-w-[420px]">
        <SheetHeader className="space-y-3 border-b border-border px-4 py-3">
          <div className="flex items-center justify-between pr-8">
            <SheetTitle>Jobs</SheetTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="cursor-pointer h-8 w-8" aria-label="Queue actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {paused ? (
                  <DropdownMenuItem
                    onSelect={async () => {
                      try {
                        await api("/api/v1/jobs/queue/resume", { method: "POST" });
                      } catch (e) {
                        toastError(`Resume failed: ${(e as Error).message}`);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <Play className="mr-2 h-3.5 w-3.5" /> Resume queue
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={async () => {
                      try {
                        await api("/api/v1/jobs/queue/pause", { method: "POST" });
                      } catch (e) {
                        toastError(`Pause failed: ${(e as Error).message}`);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <Pause className="mr-2 h-3.5 w-3.5" /> Pause queue
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {finishedHidden ? (
                  <DropdownMenuItem
                    onSelect={() => setFinishedHidden(false)}
                    className="cursor-pointer"
                  >
                    <Eye className="mr-2 h-3.5 w-3.5" /> Show finished
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => clearFinished()}
                    className="cursor-pointer"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Clear finished
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {paused && <Badge className="border-0 bg-chart-4/20 text-foreground w-fit">Paused</Badge>}
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all" className="cursor-pointer text-xs">All</TabsTrigger>
              <TabsTrigger value="running" className="cursor-pointer text-xs">Running</TabsTrigger>
              <TabsTrigger value="queued" className="cursor-pointer text-xs">Queued</TabsTrigger>
              <TabsTrigger value="finished" className="cursor-pointer text-xs">Finished</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by title or job id"
            className="h-8 text-xs"
          />
        </SheetHeader>

        <DrawerBody rows={ordered} />
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  rows,
}: {
  rows: LiveJob[];
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 4,
  });

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No jobs to show"
        description="Imports, module computes, and other long-running operations show up here."
        className="m-0 px-6"
      />
    );
  }

  const items = virtualizer.getVirtualItems();
  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((v) => {
          const job = rows[v.index];
          return (
            <div
              key={job.id}
              ref={virtualizer.measureElement}
              data-index={v.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${v.start}px)`,
                paddingBottom: 8,
              }}
            >
              <JobRow job={job} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
