"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/status-badge";
import { parseJobTitle, type JobGroup } from "@/lib/stores/jobs";
import { cn } from "@/lib/cn";

interface JobGroupHeaderProps {
  group: JobGroup;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Parent row of an import group: an honest, always-available "N of M steps"
 * determinate bar derived from how many child module jobs have finished — even
 * though no single child is required to report a percentage.
 */
export function JobGroupHeader({ group, expanded, onToggle }: JobGroupHeaderProps) {
  const { parent, done, total } = group;
  const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  const { name: cleanTitle, badge } = parseJobTitle(parent);
  const status = group.active ? "running" : parent.status;

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${cleanTitle} steps`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        "cursor-pointer space-y-2 p-3 transition-colors",
        "hover:border-primary/40 hover:bg-accent/40",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <Badge
            variant="outline"
            className="h-5 shrink-0 whitespace-nowrap border-0 bg-muted px-1.5 text-[10px]"
          >
            {badge}
          </Badge>
          <div className="truncate text-sm font-medium leading-tight">{cleanTitle}</div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="space-y-0.5 pl-[1.375rem]">
        <Progress value={pct} className="h-1" />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>
            {done} / {total} {total === 1 ? "step" : "steps"}
          </span>
          <span>{pct}%</span>
        </div>
      </div>
    </Card>
  );
}
