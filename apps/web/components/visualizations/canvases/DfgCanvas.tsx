"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  MarkerType,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";

import { formatDuration, formatNumber } from "@/lib/format";

import { elkLayout } from "../layout/layered";
import { temporalLayout } from "../layout/temporal";
import { mapDirection, mapEdgeRouting, mapEdgeType, truncate } from "../layout/direction";
import { ActivityNode, type ActivityNodeData } from "../nodes/activity-node";
import { ElkSplineEdge } from "../edges/elk-spline-edge";
import type { DfgData } from "../types";
import { CanvasShell } from "./shared/canvas-shell";
import { CanvasLayoutSkeleton } from "./shared/canvas-skeleton";
import { computeDfgVisibility } from "../dfg-filter";
import {
  useDfgSettings,
  useGeneralSettings,
  useNodePositions,
  usePersistNodePositions,
} from "../discovery-settings-context";

const nodeTypes = { activity: ActivityNode } as const;
const edgeTypes = { "elk-spline": ElkSplineEdge } as const;

interface DfgCanvasProps {
  data: DfgData;
  /** "frequency" → edges labelled with event counts; "performance" → mean duration. */
  metric?: "frequency" | "performance";
  /** Optional id of an activity to highlight. */
  highlightedActivityId?: string | null;
  /** Currently-selected element id (matches `selectionKind`). */
  selectedNodeId?: string | null;
  /** Currently-selected edge id (matches `selectionKind`). */
  selectedEdgeId?: string | null;
  /** Fired on click of a node, edge, or empty pane (passes `null` for the
   *  pane click). The parent owns the selection state so the details panel
   *  can render alongside the canvas. */
  onSelect?: (selection: { kind: "node" | "edge"; id: string } | null) => void;
  /** Optional overlay rendered on top of the canvas (e.g. details panel). */
  overlay?: ReactNode;
}

export function DfgCanvas({
  data,
  metric = "frequency",
  highlightedActivityId,
  selectedNodeId,
  selectedEdgeId,
  onSelect,
  overlay,
}: DfgCanvasProps) {
  const general = useGeneralSettings();
  const [dfg] = useDfgSettings();
  const positions = useNodePositions("dfg");
  const persist = usePersistNodePositions("dfg");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [laid, setLaid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const maxFreq = data.activities.reduce((m, a) => Math.max(m, a.frequency), 1);
    const maxEdgeFreq = data.edges.reduce((m, e) => Math.max(m, e.frequency), 1);

    const startSet = new Set(Object.keys(data.start_activities));
    const endSet = new Set(Object.keys(data.end_activities));

    // Connectivity-aware Celonis-style filter (sliders + spanning floor).
    const { visibleActivities, visibleEdges } = computeDfgVisibility(data, dfg);

    const activityNodes: Node<ActivityNodeData>[] = visibleActivities.map((a) => ({
      id: a.id,
      type: "activity",
      position: { x: 0, y: 0 },
      data: {
        label: truncate(a.label, general.nodeLabelMaxLength),
        frequency: a.frequency,
        isStart: startSet.has(a.id),
        isEnd: endSet.has(a.id),
        startCount: data.start_activities[a.id] ?? 0,
        endCount: data.end_activities[a.id] ?? 0,
        intensity:
          general.theme === "monochrome"
            ? 0
            : (a.frequency / Math.max(maxFreq, 1)) * general.colorIntensity,
        highlighted: a.id === highlightedActivityId,
      },
    }));

    // In "temporal" layout mode we lay out nodes ourselves (no ELK), so
    // there are no ELK edge sections to render along. Force a built-in
    // xyflow edge type instead of the ELK-section-aware custom one.
    const edgeType =
      dfg.layoutMode === "temporal"
        ? mapEdgeType(general.edgeRouting === "spline" ? "spline" : general.edgeRouting)
        : general.edgeRouting === "spline"
          ? "elk-spline"
          : mapEdgeType(general.edgeRouting);

    const dfgEdges: Edge[] = visibleEdges.map((e) => {
      const ratio = e.frequency / Math.max(maxEdgeFreq, 1);
      const stroke =
        dfg.edgeThicknessEncoding === "off"
          ? 1.5
          : dfg.edgeThicknessEncoding === "linear"
            ? 0.5 + 4 * ratio
            : 1 + Math.log10(1 + e.frequency);

      // Edge label modes: explicit (no silent fall-through to count when
      // duration is selected but missing — show "—" so the user knows).
      let label: string | undefined;
      if (dfg.edgeLabel === "off") {
        label = undefined;
      } else if (dfg.edgeLabel === "duration" || metric === "performance") {
        label =
          typeof e.performance_seconds === "number"
            ? formatDuration(e.performance_seconds)
            : "—";
      } else {
        // count
        label = formatNumber(e.frequency);
      }

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label,
        labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: "var(--card)", stroke: "var(--border)", strokeWidth: 1 },
        type: edgeType,
        animated: false,
        style: {
          stroke: "var(--muted-foreground)",
          strokeWidth: stroke,
          opacity: 0.5 + 0.5 * ratio,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--muted-foreground)" },
      };
    });

    // TB needs more vertical breathing room (edge labels sit on the vertical
    // segments and there's no horizontal travel to absorb them); LR is the
    // opposite. So spacing is direction-aware.
    const isVertical =
      general.layoutDirection === "TB" || general.layoutDirection === "BT";

    // Within-layer tie-breaker. Prefer real temporal order (mean_trace_position
    // from the discovery serializer v3+): activities that occur earlier in
    // traces float to the top/left of their layer. Falls back to negative
    // frequency for older cached payloads where the field is missing — both
    // are deterministic and meaningful, the temporal one is just truer.
    const positionByActivity = new Map<string, number>();
    const frequencyByActivity = new Map<string, number>();
    for (const a of visibleActivities) {
      if (typeof a.mean_trace_position === "number") {
        positionByActivity.set(a.id, a.mean_trace_position);
      }
      frequencyByActivity.set(a.id, a.frequency);
    }
    const hasTemporal = positionByActivity.size > 0;
    const nodeOrderHint = hasTemporal
      ? (id: string) => positionByActivity.get(id) ?? 1
      : (id: string) => -(frequencyByActivity.get(id) ?? 0);

    const nodeSize = isVertical
      ? { width: 220, height: 60 }
      : { width: 200, height: 64 };

    if (dfg.layoutMode === "temporal" && hasTemporal) {
      // Strict temporal: x (or y in vertical mode) = mean trace position;
      // perpendicular axis is filled lane-by-lane to avoid overlaps.
      const result = temporalLayout(activityNodes, dfgEdges, {
        direction: general.layoutDirection,
        nodeSize,
        rankByNode: (id) => positionByActivity.get(id),
      });
      const merged = result.nodes.map((n) => {
        const p = positions[n.id];
        return p ? { ...n, position: p } : n;
      });
      setNodes(merged);
      setEdges(result.edges);
      setLaid(true);
      return;
    }

    elkLayout(activityNodes, dfgEdges, {
      direction: mapDirection(general.layoutDirection),
      edgeRouting: mapEdgeRouting(general.edgeRouting),
      nodeNode: isVertical ? 56 : 36,
      nodeNodeBetweenLayers: isVertical ? 90 : 70,
      defaultSize: nodeSize,
      celonisLike: true,
      nodeOrderHint,
    }).then((result) => {
      if (cancelled) return;
      const merged = result.nodes.map((n) => {
        const p = positions[n.id];
        return p ? { ...n, position: p } : n;
      });
      setNodes(merged);
      setEdges(result.edges);
      setLaid(true);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    metric,
    highlightedActivityId,
    general.layoutDirection,
    general.edgeRouting,
    general.nodeLabelMaxLength,
    general.colorIntensity,
    general.theme,
    dfg.activitiesShown,
    dfg.connectionsShown,
    dfg.hideSelfLoops,
    dfg.edgeLabel,
    dfg.edgeThicknessEncoding,
    dfg.layoutMode,
  ]);

  const onNodeDragStop = useCallback<NodeMouseHandler>(
    (_, node) => {
      persist({ [node.id]: { x: node.position.x, y: node.position.y } });
    },
    [persist],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => onSelect?.({ kind: "node", id: node.id }),
    [onSelect],
  );
  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (_, edge) => onSelect?.({ kind: "edge", id: edge.id }),
    [onSelect],
  );
  const onPaneClick = useCallback(() => onSelect?.(null), [onSelect]);

  // Mark the currently-selected element with `selected: true` so xyflow
  // applies its own focus ring styling (and downstream nodes/edges can react).
  const decoratedNodes = nodes.map((n) =>
    n.id === selectedNodeId ? { ...n, selected: true } : n.selected ? { ...n, selected: false } : n,
  );
  const decoratedEdges = edges.map((e) =>
    e.id === selectedEdgeId ? { ...e, selected: true } : e.selected ? { ...e, selected: false } : e,
  );

  if (!laid) return <CanvasLayoutSkeleton />;
  return (
    <CanvasShell
      nodes={decoratedNodes}
      edges={decoratedEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitViewKey={`${data.kind}-${data.activities.length}`}
      miniMap={general.showMinimap}
      showGrid={general.showGrid}
      overlay={overlay}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
    />
  );
}
