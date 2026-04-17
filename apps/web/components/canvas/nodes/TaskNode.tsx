"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock, User, Cog, FileCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils";
import type { NodeData, NodeStatus } from "@/lib/schemas/graph";

const statusColor: Record<NodeStatus, string> = {
  idle: "bg-text-faint",
  active: "bg-success",
  blocked: "bg-error",
  done: "bg-info",
};

const iconByType: Record<string, React.ComponentType<{ size?: number }>> = {
  task: Cog,
  userTask: User,
  serviceTask: Cog,
  scriptTask: FileCode,
};

export function TaskNode({ data, type, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const Icon = iconByType[type ?? "task"] ?? Cog;
  const status: NodeStatus = d.status ?? "idle";

  return (
    <div
      className={cn(
        "group min-w-[160px] max-w-[240px] rounded-lg border bg-surface shadow-[0_1px_0_rgba(0,0,0,0.15)] transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-surface-2 !border-border"
      />

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Icon size={14} />
        <span
          className="flex-1 truncate text-[13px]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {d.label}
        </span>
        <span
          aria-label={`status: ${status}`}
          className={cn("h-2 w-2 shrink-0 rounded-full", statusColor[status])}
        />
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-1.5 text-[11px] text-text-muted">
        <span className="capitalize">{type?.replace(/Task$/, "")}</span>
        {typeof d.duration_ms === "number" && d.duration_ms > 0 && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock size={10} />
            {formatDuration(d.duration_ms)}
          </span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-surface-2 !border-border"
      />
    </div>
  );
}
