"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Search, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { useUi } from "@/lib/stores/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { CommandPalette } from "@/components/cmdk";
import { useShallow } from "zustand/react/shallow";
import { selectCounts, useJobsStore } from "@/lib/stores/jobs";
import { useEventLogs } from "@/lib/queries";

function isMac() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

function deriveCrumbs(pathname: string, logNames?: Map<string, string>) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return [{ href: "/processes", label: "Processes", current: true }];
  const out: { href: string; label: string; current: boolean }[] = [];
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    acc += `/${parts[i]}`;

    // Skip displaying "modules" in breadcrumb
    if (parts[i] === "modules") {
      continue;
    }

    const isLast = i === parts.length - 1;

    // Use process name if this is the logId (comes after "processes")
    let label = prettify(parts[i]);
    if (parts[i - 1] === "processes" && logNames?.has(parts[i])) {
      label = logNames.get(parts[i])!;
    }

    out.push({
      href: acc,
      label,
      current: isLast,
    });
  }
  return out;
}

function prettify(seg: string): string {
  if (/^[0-9a-f-]{8,}$/i.test(seg)) return seg;
  return seg.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Topbar() {
  const pathname = usePathname();
  const { data: logs } = useEventLogs();
  const [open, setOpen] = useState(false);

  const logNames = new Map(logs?.map((log) => [log.id, log.name]) ?? []);
  const crumbs = deriveCrumbs(pathname, logNames);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList>
          {crumbs.map((c, i) => (
            <BreadcrumbItem key={c.href}>
              {c.current ? (
                <BreadcrumbPage className="truncate">{c.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={c.href}>{c.label}</Link>
                </BreadcrumbLink>
              )}
              {i < crumbs.length - 1 && <BreadcrumbSeparator />}
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

<JobsTopbarButton />

      <AtlasTopbarButton />

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="cursor-pointer gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden md:inline">Search</span>
        <kbd className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {isMac() ? "⌘K" : "Ctrl+K"}
        </kbd>
      </Button>

      <CommandPalette open={open} onOpenChange={setOpen} />
    </header>
  );
}

function AtlasTopbarButton() {
  const open = useUi((s) => s.atlasOpen);
  const toggle = useUi((s) => s.toggleAtlas);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "cursor-pointer gap-1.5 text-muted-foreground",
        open && "text-foreground",
      )}
      onClick={toggle}
      aria-label="Toggle ATLAS AI"
      aria-pressed={open}
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span className="hidden md:inline">ATLAS AI</span>
    </Button>
  );
}

function JobsTopbarButton() {
  const counts = useJobsStore(useShallow(selectCounts));
  const setOpen = useJobsStore((s) => s.setDrawerOpen);
  const active = counts.running + counts.queued;
  const running = counts.running;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "relative cursor-pointer gap-1.5 overflow-hidden text-muted-foreground",
        active > 0 && "text-foreground",
      )}
      onClick={() => setOpen(true)}
      aria-label={active ? `${active} active jobs` : "Open jobs drawer"}
    >
      <Activity className={cn("h-3.5 w-3.5", running > 0 && "animate-heartbeat")} />
      <span className="hidden md:inline">Jobs</span>
      {active > 0 && (
        <>
          <Badge className="ml-1 h-4 min-w-4 border-0 bg-foreground/10 px-1 text-[10px] tabular-nums text-foreground">
            {active}
          </Badge>
          <span className={cn("absolute inset-x-0 bottom-0 h-[2px] bg-primary/70", running > 0 && "animate-heartbeat")} />
        </>
      )}
    </Button>
  );
}
