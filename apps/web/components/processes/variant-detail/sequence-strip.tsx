"use client";

import { ChevronRight } from "lucide-react";

export function SequenceStrip({ activities }: { activities: string[] }) {
  if (activities.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        No activities recorded for this variant.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card p-3">
      {activities.map((activity, i) => (
        <span key={`${activity}-${i}`} className="contents">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-sm">
            <span className="rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            {activity}
          </span>
          {i < activities.length - 1 && (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
      ))}
    </div>
  );
}
