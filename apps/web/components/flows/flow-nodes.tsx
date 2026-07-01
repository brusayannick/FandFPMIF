"use client";

import { memo, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BarChart3, Boxes, Database, Filter, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { VizEmpty } from "@/components/visualizations/viz-shell";
import { useFlowNodeData } from "@/lib/flow-queries";
import { vizRegistry } from "@/lib/visualizations/registry";
import type { FieldMapping } from "@/lib/visualizations/types";

import { useFlowEditor } from "./flow-context";

const HANDLE = "!h-2.5 !w-2.5 !bg-primary !border-2 !border-background";

function NodeShell({
  selected,
  icon: Icon,
  title,
  hasInput,
  hasOutput,
  width = 200,
  children,
}: {
  selected: boolean;
  icon: LucideIcon;
  title: string;
  hasInput: boolean;
  hasOutput: boolean;
  width?: number;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-sm transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
      )}
      style={{ width }}
    >
      {hasInput && <Handle type="target" position={Position.Left} className={HANDLE} />}
      <div className="flex items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium tracking-tight">{title}</span>
      </div>
      {children}
      {hasOutput && <Handle type="source" position={Position.Right} className={HANDLE} />}
    </div>
  );
}

function SubLine({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <div className={cn("truncate px-2.5 py-1.5 text-[11px]", muted ? "text-muted-foreground" : "")}>
      {children}
    </div>
  );
}

export const SourceNode = memo(function SourceNode({ selected }: NodeProps) {
  return (
    <NodeShell selected={!!selected} icon={Database} title="Event log" hasInput={false} hasOutput>
      <SubLine muted>The flow&apos;s bound log</SubLine>
    </NodeShell>
  );
});

export const ModuleNode = memo(function ModuleNode({ data, selected }: NodeProps) {
  const moduleId = typeof data.module_id === "string" ? data.module_id : null;
  const datasetId = typeof data.dataset_id === "string" ? data.dataset_id : null;
  return (
    <NodeShell selected={!!selected} icon={Boxes} title="Module" hasInput hasOutput>
      <SubLine muted={!moduleId}>
        {moduleId ? `${moduleId} · ${datasetId}` : "Pick a module + dataset"}
      </SubLine>
    </NodeShell>
  );
});

export const TransformNode = memo(function TransformNode({ data, selected }: NodeProps) {
  const transform = (data.transform ?? null) as { op?: string } | null;
  return (
    <NodeShell selected={!!selected} icon={Filter} title="Transform" hasInput hasOutput>
      <SubLine muted={!transform?.op}>{transform?.op ? transform.op : "Configure a step"}</SubLine>
    </NodeShell>
  );
});

export const VizNode = memo(function VizNode({ id, data, selected }: NodeProps) {
  const { flowId, version, hasLog } = useFlowEditor();
  const vizId = typeof data.viz_id === "string" ? data.viz_id : undefined;
  const spec = vizId ? vizRegistry[vizId] : undefined;
  const title = (typeof data.title === "string" && data.title) || spec?.title || "Visualization";
  const { data: env, isLoading, isError } = useFlowNodeData(flowId, id, {
    version,
    enabled: hasLog,
  });

  let body: ReactNode;
  if (!hasLog) body = <VizEmpty message="Bind an event log to the flow." />;
  else if (!spec) body = <VizEmpty message="Pick a visualization." />;
  else if (isLoading) body = <Skeleton className="h-full w-full" />;
  else if (isError || !env) body = <VizEmpty message="Connect a dataset to this node." />;
  else if (!spec.accepts.includes(env.shape))
    body = <VizEmpty message="This viz can't render that data." />;
  else {
    const Viz = spec.Component;
    body = (
      <Viz
        dataset={env}
        mapping={(data.mapping ?? {}) as FieldMapping}
        options={(data.config ?? {}) as Record<string, unknown>}
      />
    );
  }

  return (
    <NodeShell selected={!!selected} icon={BarChart3} title={title} hasInput hasOutput={false} width={300}>
      {/* pointer-events-none: the preview never captures the drag/zoom gesture,
          so the node still drags from anywhere and nested viz stay static. */}
      <div className="pointer-events-none h-44 w-full overflow-hidden p-1">{body}</div>
    </NodeShell>
  );
});

export const flowNodeTypes = {
  source: SourceNode,
  module: ModuleNode,
  transform: TransformNode,
  viz: VizNode,
};
