"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

import { temporalLayout } from "../layout/temporal";
import { temporalPhasesLayout } from "../layout/temporal-phases";
import { temporalSwimlaneLayout } from "../layout/temporal-swimlane";
import { happyPathTowerLayout } from "../layout/happy-path-tower";
import { dominantFlowLayout } from "../layout/dominant-flow";
import { mapEdgeType, truncate } from "../layout/direction";
import { ActivityNode, type ActivityNodeData } from "../nodes/activity-node";
import { ElkSplineEdge } from "../edges/elk-spline-edge";
import { DfgNodeMenu, type DfgNodeMenuTarget } from "../dfg-node-menu";
import type { DfgData } from "../types";
import { CanvasShell } from "@/components/visualizations/canvases/shared/canvas-shell";
import { CanvasLayoutSkeleton } from "@/components/visualizations/canvases/shared/canvas-skeleton";
import { computeDfgVisibility } from "../dfg-filter";
import {
  useDfgSettings,
  useDiscoveryScope,
  useGeneralSettings,
  useNodePositions,
  usePersistNodePositions,
} from "../discovery-settings-context";

const nodeTypes = { activity: ActivityNode } as const;
const edgeTypes = { "elk-spline": ElkSplineEdge } as const;

/** Duration of the node-position morph when a re-layout replaces an existing one. */
const LAYOUT_ANIMATION_MS = 420;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

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
  /** Override the canvas wrapper sizing. Defaults to the panel's fixed-height
   *  shell; dashboard widgets pass `h-full w-full …` to fill their card. */
  shellClassName?: string;
}

export function DfgCanvas({
  data,
  metric = "frequency",
  highlightedActivityId,
  selectedNodeId,
  selectedEdgeId,
  onSelect,
  overlay,
  shellClassName,
}: DfgCanvasProps) {
  const { logId } = useDiscoveryScope();
  const general = useGeneralSettings();
  const [dfg] = useDfgSettings();
  const positions = useNodePositions("dfg");
  const persist = usePersistNodePositions("dfg");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [laid, setLaid] = useState(false);
  // Bumped when a layout-mode switch finishes animating → CanvasShell re-fits
  // the viewport to the new geometry (stale-bbox fits are what you'd get from
  // keying on the mode directly, since positions land after the animation).
  const [fitNonce, setFitNonce] = useState(0);
  const [menu, setMenu] = useState<DfgNodeMenuTarget | null>(null);

  // Latest committed nodes – animation start positions, without wiring the
  // node state into the layout effect's dependencies.
  const nodesRef = useRef<Node[]>([]);
  nodesRef.current = nodes;
  const animRef = useRef(0);
  const lastModeRef = useRef<typeof dfg.layoutMode | null>(null);

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

    const isFlow = dfg.layoutMode === "flow-vertical" || dfg.layoutMode === "flow-horizontal";
    // Flow layouts render along ELK's routed bend points (orthogonal channels,
    // rounded corners) via the elk-spline edge; the other layouts keep the
    // user-selected xyflow curve style.
    const edgeType = isFlow
      ? ("elk-spline" as const)
      : mapEdgeType(general.edgeRouting === "spline" ? "spline" : general.edgeRouting);

    const dfgEdges: Edge[] = visibleEdges.map((e) => {
      const ratio = e.frequency / Math.max(maxEdgeFreq, 1);
      const stroke =
        dfg.edgeThicknessEncoding === "off"
          ? 1.5
          : dfg.edgeThicknessEncoding === "linear"
            ? 0.5 + 4 * ratio
            : 1 + Math.log10(1 + e.frequency);

      // Edge label modes: explicit (no silent fall-through to count when
      // duration is selected but missing – show "–" so the user knows).
      let label: string | undefined;
      if (dfg.edgeLabel === "off") {
        label = undefined;
      } else if (dfg.edgeLabel === "duration" || metric === "performance") {
        label =
          typeof e.performance_seconds === "number"
            ? formatDuration(e.performance_seconds)
            : "–";
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
    // opposite. So spacing is direction-aware. Flow layouts fix their own
    // direction and ignore the general layout-direction setting.
    const isVertical = isFlow
      ? dfg.layoutMode === "flow-vertical"
      : general.layoutDirection === "TB" || general.layoutDirection === "BT";

    // Within-layer tie-breaker. Prefer real temporal order (mean_trace_position
    // from the discovery serializer v3+): activities that occur earlier in
    // traces float to the top/left of their layer. Falls back to negative
    // frequency for older cached payloads where the field is missing – both
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

    const nodeSize = isVertical
      ? { width: 220, height: 60 }
      : { width: 200, height: 64 };

    const modeChanged = lastModeRef.current !== null && lastModeRef.current !== dfg.layoutMode;
    lastModeRef.current = dfg.layoutMode;

    /** Merge persisted (dragged) positions, then commit – animating the node
     *  movement when this re-layout replaces an already-rendered one, so a
     *  layout switch morphs instead of snapping. */
    const apply = (result: { nodes: Node<ActivityNodeData>[]; edges: Edge[] }) => {
      if (cancelled) return;
      const merged = result.nodes.map((n) => {
        const p = positions[n.id];
        return p ? { ...n, position: p } : n;
      });

      window.cancelAnimationFrame(animRef.current);
      setEdges(result.edges);

      const prev = new Map(nodesRef.current.map((n) => [n.id, n.position] as const));
      const moves = merged.some((n) => {
        const p = prev.get(n.id);
        return p && (Math.abs(p.x - n.position.x) > 0.5 || Math.abs(p.y - n.position.y) > 0.5);
      });

      const finish = () => {
        setNodes(merged);
        setLaid(true);
        if (modeChanged) setFitNonce((v) => v + 1);
      };

      if (!laid || !moves) {
        finish();
        return;
      }

      const from = merged.map((n) => prev.get(n.id) ?? n.position);
      const start = performance.now();
      const step = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - start) / LAYOUT_ANIMATION_MS);
        if (t >= 1) {
          finish();
          return;
        }
        const k = easeInOutCubic(t);
        setNodes(
          merged.map((n, i) => ({
            ...n,
            position: {
              x: from[i]!.x + (n.position.x - from[i]!.x) * k,
              y: from[i]!.y + (n.position.y - from[i]!.y) * k,
            },
          })),
        );
        animRef.current = window.requestAnimationFrame(step);
      };
      animRef.current = window.requestAnimationFrame(step);
    };

    if (isFlow) {
      // Celonis-style layered flow (ELK, async): dominant path straightened
      // into the central spine, orthogonal-ish routing.
      const edgeFreqMap = new Map<string, number>();
      for (const e of visibleEdges) edgeFreqMap.set(`${e.source}\u0000${e.target}`, e.frequency);
      void dominantFlowLayout(activityNodes, dfgEdges, {
        direction: dfg.layoutMode === "flow-vertical" ? "DOWN" : "RIGHT",
        nodeSize,
        edgeFrequency: (s, t) => edgeFreqMap.get(`${s}\u0000${t}`) ?? 0,
        frequencyByNode: (id) => frequencyByActivity.get(id) ?? 0,
        startActivityIds: startSet,
        endActivityIds: endSet,
        rankByNode: (id) => positionByActivity.get(id),
      }).then(apply);
    } else if (dfg.layoutMode === "temporal" && hasTemporal) {
      apply(
        temporalLayout(activityNodes, dfgEdges, {
          direction: general.layoutDirection,
          nodeSize,
          rankByNode: (id) => positionByActivity.get(id),
        }),
      );
    } else if (
      (dfg.layoutMode === "temporal-phases-2" || dfg.layoutMode === "temporal-phases-3") &&
      hasTemporal
    ) {
      const phaseConfig = {
        "temporal-phases-2": { phaseCount: 5, phaseGapMultiplier: 3 },
        "temporal-phases-3": { phaseCount: 7, phaseGapMultiplier: 2 },
      } as const;
      const { phaseCount, phaseGapMultiplier } = phaseConfig[dfg.layoutMode];
      apply(
        temporalPhasesLayout(activityNodes, dfgEdges, {
          direction: general.layoutDirection,
          nodeSize,
          phaseCount,
          phaseGapMultiplier,
          rankByNode: (id) => positionByActivity.get(id),
          frequencyByNode: (id) => frequencyByActivity.get(id) ?? 0,
        }),
      );
    } else if (dfg.layoutMode === "temporal-swimlane" && hasTemporal) {
      apply(
        temporalSwimlaneLayout(activityNodes, dfgEdges, {
          direction: general.layoutDirection,
          nodeSize,
          rankByNode: (id) => positionByActivity.get(id),
          startCountByNode: (id) => data.start_activities[id] ?? 0,
          endCountByNode: (id) => data.end_activities[id] ?? 0,
          frequencyByNode: (id) => frequencyByActivity.get(id) ?? 0,
        }),
      );
    } else if (dfg.layoutMode === "happy-path-tower") {
      const edgeFreqMap = new Map<string, number>();
      for (const e of visibleEdges) edgeFreqMap.set(`${e.source}__${e.target}`, e.frequency);
      apply(
        happyPathTowerLayout(activityNodes, dfgEdges, {
          direction: general.layoutDirection,
          nodeSize,
          rankByNode: (id) => positionByActivity.get(id),
          edgeFrequency: (src, tgt) => edgeFreqMap.get(`${src}__${tgt}`) ?? 0,
          frequencyByNode: (id) => frequencyByActivity.get(id) ?? 0,
          startActivityIds: startSet,
          endActivityIds: endSet,
        }),
      );
    } else {
      // Fallback: temporal-family mode without rank data → plain temporal (no ranks).
      apply(
        temporalLayout(activityNodes, dfgEdges, {
          direction: general.layoutDirection,
          nodeSize,
          rankByNode: () => undefined,
        }),
      );
    }

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animRef.current);
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
    dfg.edgeTopPercent,
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
    (_, node) => {
      setMenu(null);
      onSelect?.({ kind: "node", id: node.id });
    },
    [onSelect],
  );
  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (_, edge) => {
      setMenu(null);
      onSelect?.({ kind: "edge", id: edge.id });
    },
    [onSelect],
  );
  const onPaneClick = useCallback(() => {
    setMenu(null);
    onSelect?.(null);
  }, [onSelect]);

  // Right-click on an activity node → cross-view jump menu (performance,
  // variants). preventDefault suppresses the browser context menu.
  const onNodeContextMenu = useCallback<NodeMouseHandler>((event, node) => {
    event.preventDefault();
    const label = (node.data as ActivityNodeData | undefined)?.label;
    setMenu({
      activityId: node.id,
      label: typeof label === "string" && label.length > 0 ? label : node.id,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  // Multi-selection via rubber-band: clear the single-node details panel.
  const onSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: typeof nodes; edges: typeof edges }) => {
      if (selected.length > 1) onSelect?.(null);
    },
    [onSelect],
  );

  // Ensure the externally-controlled selectedNodeId is visually selected.
  // Don't clear other nodes' selection so rubber-band multi-select is preserved.
  const decoratedNodes = nodes.map((n) =>
    n.id === selectedNodeId && !n.selected ? { ...n, selected: true } : n,
  );
  const decoratedEdges = edges.map((e) =>
    e.id === selectedEdgeId && !e.selected ? { ...e, selected: true } : e,
  );

  if (!laid) return <CanvasLayoutSkeleton />;
  return (
    <CanvasShell
      className={shellClassName}
      nodes={decoratedNodes}
      edges={decoratedEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitViewKey={`${data.kind}-${data.activities.length}-${fitNonce}`}
      miniMap={general.showMinimap}
      showGrid={general.showGrid}
      overlay={
        <>
          {menu ? (
            <DfgNodeMenu target={menu} logId={logId} onClose={() => setMenu(null)} />
          ) : null}
          {overlay}
        </>
      }
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={onNodeClick}
      onNodeContextMenu={onNodeContextMenu}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      onSelectionChange={onSelectionChange}
    />
  );
}
