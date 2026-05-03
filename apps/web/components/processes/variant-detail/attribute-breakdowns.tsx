"use client";

import type { AttributeBreakdown } from "@/lib/api-types";
import { formatNumber } from "@/lib/format";

export function AttributeBreakdowns({ breakdowns }: { breakdowns: AttributeBreakdown[] }) {
  if (breakdowns.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        No additional attributes were recorded on this log.
      </p>
    );
  }

  // Skip purely empty columns so the panel doesn't fill with "—".
  const filtered = breakdowns.filter((b) => b.top.length > 0);
  if (filtered.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Attributes for this variant are all empty.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {filtered.map((b) => (
        <div key={b.column}>
          <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            {b.label}
          </div>
          <ul className="space-y-1">
            {b.top.map((entry, i) => (
              <li
                key={`${entry.value}-${i}`}
                className="flex items-center justify-between text-sm"
              >
                <span className="truncate">
                  {entry.value === null || entry.value === undefined
                    ? <span className="italic text-muted-foreground">empty</span>
                    : String(entry.value)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatNumber(entry.count)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
