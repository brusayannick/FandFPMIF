"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeData } from "@/lib/schemas/graph";

export function SubprocessNode({ data, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  return (
    <div
      className={cn(
        "min-w-[180px] rounded-md border-2 bg-surface px-3 py-3",
        selected ? "border-primary" : "border-dashed border-border",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-surface-2 !border-border"
      />
      <div className="flex items-center gap-2 text-[13px]">
        <Layers size={14} className="text-text-muted" />
        <span className="truncate">{d.label}</span>
      </div>
      <div className="mt-1 text-[11px] text-text-muted">Subprocess</div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-surface-2 !border-border"
      />
    </div>
  );
}
