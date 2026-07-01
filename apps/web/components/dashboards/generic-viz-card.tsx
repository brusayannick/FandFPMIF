"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { VizEmpty } from "@/components/visualizations/viz-shell";
import { FieldMappingForm, type VizPatch } from "@/components/visualizations/field-mapping-form";
import { vizRegistry } from "@/lib/visualizations/registry";
import { useDatasetData } from "@/lib/visualizations/use-dataset-data";
import { useFlow, useFlowNodeData } from "@/lib/flow-queries";
import type { DashboardItem } from "@/lib/dashboard-queries";
import type { FieldMapping } from "@/lib/visualizations/types";

/**
 * Body of a `kind:"viz"` dashboard card. Fetches + normalizes the module
 * dataset (`useDatasetData`) and renders the chosen generic visualization
 * against it, honoring the board's global filters automatically. Shows an
 * unconfigured hint until a visualization is chosen.
 */
export function GenericVizBody({ item, logId }: { item: DashboardItem; logId: string | null }) {
  const { envelope, isLoading, isError, missing } = useDatasetData(item, logId);
  const spec = item.viz_id ? vizRegistry[item.viz_id] : undefined;

  if (!logId) return <VizEmpty message="Select an event log to populate this card." />;
  if (missing) return <VizEmpty message="This dataset's module isn't installed." />;
  if (!item.viz_id || !spec) return <VizEmpty message="Open settings to choose a visualization." />;
  if (isLoading) return <Skeleton className="h-full w-full" />;
  if (isError || !envelope) return <VizEmpty message="Couldn't load this dataset." />;
  if (!spec.accepts.includes(envelope.shape)) {
    return <VizEmpty message="This visualization can't render this dataset." />;
  }

  const Viz = spec.Component;
  return (
    <Viz
      dataset={envelope}
      mapping={(item.mapping ?? {}) as FieldMapping}
      options={(item.config ?? {}) as Record<string, unknown>}
    />
  );
}

/** Body of a `kind:"flow"` card - renders a flow's terminal viz node. The viz
 * config (viz_id, mapping, options) lives on the flow node, so we read it from
 * the flow detail and fetch the node's envelope from the flow engine. */
export function FlowCardBody({ item }: { item: DashboardItem }) {
  const flowId = item.flow_id ?? "";
  const nodeId = item.node_id ?? "";
  const { data: flow } = useFlow(flowId || null);
  const node = flow?.graph.nodes.find((n) => n.id === nodeId);
  const vizId = typeof node?.data.viz_id === "string" ? node.data.viz_id : undefined;
  const spec = vizId ? vizRegistry[vizId] : undefined;
  const { data: env, isLoading, isError } = useFlowNodeData(flowId, nodeId, {
    enabled: !!flowId && !!nodeId,
  });

  if (!flowId || !nodeId) return <VizEmpty message="No flow node bound." />;
  if (isLoading) return <Skeleton className="h-full w-full" />;
  if (!spec) return <VizEmpty message="This flow node has no visualization." />;
  if (isError || !env) return <VizEmpty message="Couldn't load this flow node." />;
  if (!spec.accepts.includes(env.shape)) return <VizEmpty message="Incompatible visualization." />;

  const Viz = spec.Component;
  return (
    <Viz
      dataset={env}
      mapping={(node?.data.mapping ?? {}) as FieldMapping}
      options={(node?.data.config ?? {}) as Record<string, unknown>}
    />
  );
}

/** Settings popover content for a viz card - wires the field-mapping form to the
 * (cached) dataset so it can offer column bindings. */
export function VizSettings({
  item,
  logId,
  onChange,
}: {
  item: DashboardItem;
  logId: string | null;
  onChange: (patch: VizPatch) => void;
}) {
  const { envelope, shape } = useDatasetData(item, logId);
  return <FieldMappingForm item={item} dataset={envelope} shape={shape} onChange={onChange} />;
}
