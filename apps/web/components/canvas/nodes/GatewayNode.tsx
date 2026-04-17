"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { NodeData } from "@/lib/schemas/graph";

const symbolByType: Record<string, string> = {
  gateway: "×",
  exclusiveGateway: "×",
  parallelGateway: "+",
  inclusiveGateway: "○",
};

export function GatewayNode({ data, type, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const symbol = symbolByType[type ?? "gateway"] ?? "×";

  return (
    <div className="relative flex flex-col items-center">
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-surface-2 !border-border"
      />
      <div
        className={cn(
          "flex h-12 w-12 rotate-45 items-center justify-center border bg-surface",
          selected ? "border-primary" : "border-text-muted/60",
        )}
      >
        <span className="-rotate-45 text-lg leading-none text-text-muted">
          {symbol}
        </span>
      </div>
      <div className="mt-1 max-w-[140px] truncate text-center text-[11px] text-text-muted">
        {d.label}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-surface-2 !border-border"
      />
    </div>
  );
}
