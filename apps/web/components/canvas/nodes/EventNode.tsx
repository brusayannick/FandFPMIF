"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { NodeData } from "@/lib/schemas/graph";

export function EventNode({ data, type, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const isStart = type === "startEvent";
  const isEnd = type === "endEvent";

  const ring = selected
    ? "ring-2 ring-primary"
    : isStart
      ? "ring-[1.5px] ring-success/70"
      : isEnd
        ? "ring-[2px] ring-error/70"
        : "ring-[1.5px] ring-text-muted/50";

  return (
    <div className="relative flex flex-col items-center">
      {!isStart && (
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-surface-2 !border-border"
        />
      )}
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full bg-surface",
          ring,
        )}
      >
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            isStart ? "bg-success" : isEnd ? "bg-error" : "bg-text-muted",
          )}
          aria-hidden
        />
      </div>
      <div className="mt-1 max-w-[120px] truncate text-center text-[11px] text-text-muted">
        {d.label}
      </div>
      {!isEnd && (
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-surface-2 !border-border"
        />
      )}
    </div>
  );
}
