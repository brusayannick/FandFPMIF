"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { Field } from "@/components/dashboards/card-config-form";
import {
  dashboardKeys,
  useDashboards,
  useDatasetCatalog,
  type DashboardDetail,
  type LogModel,
} from "@/lib/dashboard-queries";
import { useFlowNodeData, type FlowNode } from "@/lib/flow-queries";
import { vizzesForShape } from "@/lib/visualizations/registry";
import type { ColumnSpec, FieldMapping, VizSpec } from "@/lib/visualizations/types";

const FILTER_OPS = ["equals", "contains", "gte", "lte", "is_null", "is_not_null"] as const;
const AGG_FNS = ["sum", "avg", "count", "count_distinct", "min", "max"] as const;
const TRANSFORM_OPS = [
  "filter",
  "select",
  "sort",
  "limit",
  "aggregate",
  "pivot",
  "unpivot",
  "computed",
  "rename",
  "dedupe",
  "join",
] as const;
const PIVOT_AGGS = ["sum", "avg", "count", "min", "max"] as const;
const JOIN_HOWS = ["inner", "left", "right", "outer"] as const;

type Patch = (patch: Record<string, unknown>) => void;

/** Right-rail configuration for the selected node. Module nodes pick a dataset;
 * transform nodes pick an op + params; viz nodes pick a visualization + map
 * fields. Transform/viz column pickers read the *upstream* node's columns. */
export function NodeInspector({
  flowId,
  version,
  logModel,
  node,
  upstreamNodeId,
  patchNodeData,
}: {
  flowId: string;
  version: number;
  logModel: LogModel;
  node: FlowNode | null;
  upstreamNodeId: string | null;
  patchNodeData: (id: string, patch: Record<string, unknown>) => void;
}) {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Select a node to configure it.
      </div>
    );
  }
  const patch: Patch = (p) => patchNodeData(node.id, p);

  return (
    <div className="space-y-3.5 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {node.type} node
      </p>
      {node.type === "source" && (
        <p className="text-[11px] text-muted-foreground">
          Feeds the flow&apos;s bound event log into connected module nodes.
        </p>
      )}
      {node.type === "module" && <ModuleInspector logModel={logModel} node={node} patch={patch} />}
      {node.type === "transform" && (
        <TransformInspector flowId={flowId} version={version} upstreamNodeId={upstreamNodeId} node={node} patch={patch} />
      )}
      {node.type === "viz" && (
        <VizInspector flowId={flowId} version={version} upstreamNodeId={upstreamNodeId} node={node} patch={patch} />
      )}
    </div>
  );
}

function ModuleInspector({ logModel, node, patch }: { logModel: LogModel; node: FlowNode; patch: Patch }) {
  const { data: catalog } = useDatasetCatalog();
  const options = (catalog ?? []).filter((d) => d.log_models.includes(logModel));
  const current =
    node.data.module_id && node.data.dataset_id
      ? `${node.data.module_id}::${node.data.dataset_id}`
      : "";
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Dataset</Label>
      <Select
        value={current}
        onValueChange={(v) => {
          const [module_id, dataset_id] = v.split("::");
          patch({ module_id, dataset_id });
        }}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Pick a module dataset" />
        </SelectTrigger>
        <SelectContent>
          {options.map((d) => (
            <SelectItem key={`${d.module_id}::${d.dataset_id}`} value={`${d.module_id}::${d.dataset_id}`} className="text-xs">
              {d.module_name} · {d.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function useUpstreamColumns(flowId: string, upstreamNodeId: string | null, version: number) {
  const { data: env } = useFlowNodeData(flowId, upstreamNodeId ?? "", {
    version,
    enabled: !!upstreamNodeId,
  });
  const columns: ColumnSpec[] = env?.schema.columns ?? [];
  return { env, columns };
}

function ColumnSelect({
  value,
  columns,
  placeholder,
  onChange,
  allowEmpty,
}: {
  value?: string;
  columns: ColumnSpec[];
  placeholder: string;
  onChange: (v: string | undefined) => void;
  allowEmpty?: boolean;
}) {
  return (
    <Select value={value ?? "__none__"} onValueChange={(v) => onChange(v === "__none__" ? undefined : v)}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && (
          <SelectItem value="__none__" className="text-xs">
            (none)
          </SelectItem>
        )}
        {columns.map((c) => (
          <SelectItem key={c.id} value={c.id} className="text-xs">
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TransformInspector({
  flowId,
  version,
  upstreamNodeId,
  node,
  patch,
}: {
  flowId: string;
  version: number;
  upstreamNodeId: string | null;
  node: FlowNode;
  patch: Patch;
}) {
  const { columns } = useUpstreamColumns(flowId, upstreamNodeId, version);
  const transform = (node.data.transform ?? {}) as Record<string, unknown>;
  const op = typeof transform.op === "string" ? transform.op : "";
  const set = (next: Record<string, unknown>) => patch({ transform: { ...transform, ...next } });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Operation</Label>
        <Select value={op} onValueChange={(v) => patch({ transform: { op: v } })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Pick an operation" />
          </SelectTrigger>
          <SelectContent>
            {TRANSFORM_OPS.map((o) => (
              <SelectItem key={o} value={o} className="text-xs">
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {op === "filter" && (
        <FilterParams columns={columns} transform={transform} set={set} />
      )}
      {op === "select" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Keep column</Label>
          <ColumnSelect
            value={((transform.columns as string[]) ?? [])[0]}
            columns={columns}
            placeholder="Column"
            onChange={(v) => set({ columns: v ? [v] : [] })}
          />
          <p className="text-[11px] text-muted-foreground">v1 keeps one column; chain to keep more.</p>
        </div>
      )}
      {op === "sort" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Sort by</Label>
          <ColumnSelect value={transform.by as string} columns={columns} placeholder="Column" onChange={(v) => set({ by: v })} />
          <Select value={(transform.dir as string) ?? "asc"} onValueChange={(v) => set({ dir: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="asc" className="text-xs">Ascending</SelectItem>
              <SelectItem value="desc" className="text-xs">Descending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {op === "limit" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Max rows</Label>
          <Input
            type="number"
            min={1}
            value={typeof transform.n === "number" ? transform.n : 100}
            onChange={(e) => set({ n: Number(e.target.value) || 0 })}
            className="h-8 text-xs"
          />
        </div>
      )}
      {op === "aggregate" && <AggregateParams columns={columns} transform={transform} set={set} />}

      {op === "pivot" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Rows (index)</Label>
          <ColumnSelect value={((transform.index as string[]) ?? [])[0]} columns={columns} placeholder="Column" onChange={(v) => set({ index: v ? [v] : [] })} />
          <Label className="text-xs">Columns from</Label>
          <ColumnSelect value={transform.columns as string} columns={columns} placeholder="Column" onChange={(v) => set({ columns: v })} />
          <Label className="text-xs">Values</Label>
          <ColumnSelect value={transform.values as string} columns={columns} placeholder="Column" onChange={(v) => set({ values: v })} />
          <Select value={(transform.agg as string) ?? "sum"} onValueChange={(v) => set({ agg: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PIVOT_AGGS.map((a) => (<SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      )}
      {op === "unpivot" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Keep column (id)</Label>
          <ColumnSelect value={((transform.id_vars as string[]) ?? [])[0]} columns={columns} placeholder="Column" onChange={(v) => set({ id_vars: v ? [v] : [] })} />
          <p className="text-[11px] text-muted-foreground">Other columns melt into variable/value rows.</p>
        </div>
      )}
      {op === "computed" && (
        <div className="space-y-1.5">
          <Label className="text-xs">New column name</Label>
          <Input value={(transform.as as string) ?? ""} onChange={(e) => set({ as: e.target.value })} placeholder="e.g. ratio" className="h-8 text-xs" />
          <Label className="text-xs">Left (column or number)</Label>
          <Input value={(transform.left as string) ?? ""} onChange={(e) => set({ left: e.target.value })} className="h-8 text-xs" />
          <Select value={(transform.operator as string) ?? "+"} onValueChange={(v) => set({ operator: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["+", "-", "*", "/"].map((o) => (<SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>))}
            </SelectContent>
          </Select>
          <Label className="text-xs">Right (column or number)</Label>
          <Input value={(transform.right as string) ?? ""} onChange={(e) => set({ right: e.target.value })} className="h-8 text-xs" />
        </div>
      )}
      {op === "rename" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Column</Label>
          <ColumnSelect value={transform.from as string} columns={columns} placeholder="Column" onChange={(v) => set({ from: v })} />
          <Label className="text-xs">New name</Label>
          <Input value={(transform.to as string) ?? ""} onChange={(e) => set({ to: e.target.value })} className="h-8 text-xs" />
        </div>
      )}
      {op === "dedupe" && <p className="text-[11px] text-muted-foreground">Removes duplicate rows.</p>}
      {op === "join" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Join on</Label>
          <ColumnSelect value={transform.on as string} columns={columns} placeholder="Key column" onChange={(v) => set({ on: v })} />
          <Select value={(transform.how as string) ?? "inner"} onValueChange={(v) => set({ how: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {JOIN_HOWS.map((h) => (<SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">Connect two datasets into this node.</p>
        </div>
      )}
    </div>
  );
}

function FilterParams({
  columns,
  transform,
  set,
}: {
  columns: ColumnSpec[];
  transform: Record<string, unknown>;
  set: (n: Record<string, unknown>) => void;
}) {
  const filter = (((transform.filters as Record<string, unknown>[]) ?? [])[0] ?? {}) as Record<string, unknown>;
  const update = (n: Record<string, unknown>) => set({ filters: [{ ...filter, ...n }] });
  const op = (filter.op as string) ?? "equals";
  const valueless = op === "is_null" || op === "is_not_null";
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Field</Label>
      <ColumnSelect value={filter.field as string} columns={columns} placeholder="Column" onChange={(v) => update({ field: v })} />
      <Select value={op} onValueChange={(v) => update({ op: v })}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {FILTER_OPS.map((o) => (
            <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!valueless && (
        <Input
          value={(filter.value as string) ?? ""}
          onChange={(e) => update({ value: e.target.value })}
          placeholder="Value"
          className="h-8 text-xs"
        />
      )}
    </div>
  );
}

function AggregateParams({
  columns,
  transform,
  set,
}: {
  columns: ColumnSpec[];
  transform: Record<string, unknown>;
  set: (n: Record<string, unknown>) => void;
}) {
  const agg = (((transform.aggregations as Record<string, unknown>[]) ?? [])[0] ?? {}) as Record<string, unknown>;
  const updateAgg = (n: Record<string, unknown>) => set({ aggregations: [{ ...agg, ...n }] });
  const groupBy = ((transform.group_by as string[]) ?? [])[0];
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Group by</Label>
      <ColumnSelect value={groupBy} columns={columns} placeholder="Column" allowEmpty onChange={(v) => set({ group_by: v ? [v] : [] })} />
      <Label className="text-xs">Aggregate</Label>
      <Select value={(agg.fn as string) ?? "sum"} onValueChange={(v) => updateAgg({ fn: v, as: `${v}_value` })}>
        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {AGG_FNS.map((f) => (
            <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ColumnSelect value={agg.column as string} columns={columns} placeholder="Of column" allowEmpty onChange={(v) => updateAgg({ column: v })} />
    </div>
  );
}

function VizInspector({
  flowId,
  version,
  upstreamNodeId,
  node,
  patch,
}: {
  flowId: string;
  version: number;
  upstreamNodeId: string | null;
  node: FlowNode;
  patch: Patch;
}) {
  const { env, columns } = useUpstreamColumns(flowId, upstreamNodeId, version);
  const shape = env?.shape;
  const vizzes = shape ? vizzesForShape(shape) : [];
  const vizId = typeof node.data.viz_id === "string" ? node.data.viz_id : "";
  const spec = vizId ? vizzes.find((v) => v.id === vizId) : undefined;
  const mapping = (node.data.mapping ?? {}) as FieldMapping;
  const config = (node.data.config ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Title</Label>
        <Input
          value={(node.data.title as string) ?? ""}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Visualization"
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Visualization</Label>
        <Select value={vizId} onValueChange={(v) => patch({ viz_id: v })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={shape ? "Choose a visualization" : "Connect a dataset first"} />
          </SelectTrigger>
          <SelectContent>
            {vizzes.map((v) => (
              <SelectItem key={v.id} value={v.id} className="text-xs">{v.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {spec && spec.fields.length > 0 && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          {spec.fields.map((f) => {
            const opts = columns.filter((c) => f.accepts.includes(c.type));
            const value = (() => {
              const m = mapping[f.key];
              return Array.isArray(m) ? m[0] : (m as string | undefined);
            })();
            return (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-xs">{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
                <ColumnSelect
                  value={value}
                  columns={opts}
                  placeholder="Auto"
                  allowEmpty
                  onChange={(v) => patch({ mapping: { ...mapping, [f.key]: v } })}
                />
              </div>
            );
          })}
        </div>
      )}

      {spec?.options?.properties && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          {Object.entries(spec.options.properties).map(([key, prop]) => (
            <Field key={key} fieldKey={key} prop={prop} value={config[key]} onChange={(v) => patch({ config: { ...config, [key]: v } })} />
          ))}
        </div>
      )}

      {vizId && <SendToDashboard flowId={flowId} node={node} spec={spec} />}
    </div>
  );
}

function SendToDashboard({ flowId, node, spec }: { flowId: string; node: FlowNode; spec?: VizSpec }) {
  const qc = useQueryClient();
  const { data: dashboards } = useDashboards();

  const send = async (dashId: string) => {
    const detail = await api<DashboardDetail>(`/api/v1/dashboards/${dashId}`);
    const bottom = detail.items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
    const geo = spec?.defaults ?? { w: 7, h: 8 };
    const item = {
      i:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `c-${Date.now()}`,
      kind: "flow",
      flow_id: flowId,
      node_id: node.id,
      title: (node.data.title as string) || spec?.title || "Flow visualization",
      x: 0,
      y: bottom,
      w: geo.w,
      h: geo.h,
      mapping: {},
      config: {},
    };
    await api(`/api/v1/dashboards/${dashId}`, {
      method: "PATCH",
      json: { items: [...detail.items, item] },
    });
    qc.invalidateQueries({ queryKey: dashboardKeys.detail(dashId) });
  };

  return (
    <div className="space-y-1.5 border-t border-border/60 pt-3">
      <Label className="text-xs">Send to dashboard</Label>
      <Select value="" onValueChange={(v) => void send(v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Pick a dashboard" />
        </SelectTrigger>
        <SelectContent>
          {(dashboards ?? []).map((d) => (
            <SelectItem key={d.id} value={d.id} className="text-xs">
              {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">Places this node as a card on the board.</p>
    </div>
  );
}
