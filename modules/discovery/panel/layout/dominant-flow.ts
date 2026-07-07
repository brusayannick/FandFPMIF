import type { Edge, Node } from "@xyflow/react";

import { elkLayout } from "./layered";

/**
 * Celonis-style "flow" layout for DFGs.
 *
 * Layered / Sugiyama via ELK with one twist: the dominant path – the greedy
 * highest-frequency walk from the busiest start activity to an end activity –
 * is straightened into a single spine along the flow axis (vertical for DOWN,
 * horizontal for RIGHT) by giving its edges maximum straightness + direction
 * priority. Network-simplex layering/placement honours those priorities, so
 * the spine comes out as one straight line with everything else hanging off
 * it, crossing-minimised. Edges route orthogonally (the elk-spline edge
 * renderer rounds the corners – the Celonis look).
 */

export interface DominantFlowOptions {
  /** DOWN = Celonis-style top-down flow; RIGHT = left-to-right variant. */
  direction: "DOWN" | "RIGHT";
  nodeSize: { width: number; height: number };
  /** Frequency of the directly-follows relation source→target (0 if absent). */
  edgeFrequency: (source: string, target: string) => number;
  frequencyByNode: (nodeId: string) => number;
  startActivityIds: Set<string>;
  endActivityIds: Set<string>;
  /** Temporal rank ∈ [0,1] (mean_trace_position). Used as the model-order
   *  hint so feedback edges keep pointing backwards; may return undefined
   *  for pre-v3 payloads (frequency then drives the order). */
  rankByNode: (nodeId: string) => number | undefined;
}

/**
 * Ordered greedy dominant path: start at the highest-frequency start
 * activity, repeatedly follow the highest-frequency outgoing edge to an
 * unvisited node, stop at an end activity (or when stuck). Same walk as the
 * Happy Path Tower layout, but returns the *ordered* sequence – needed to
 * know which edges form the spine.
 */
export function findDominantPath(
  nodeIds: Set<string>,
  edges: ReadonlyArray<{ source: string; target: string }>,
  opts: Pick<
    DominantFlowOptions,
    "edgeFrequency" | "frequencyByNode" | "startActivityIds" | "endActivityIds"
  >,
): string[] {
  const candidates =
    opts.startActivityIds.size > 0
      ? [...opts.startActivityIds].filter((id) => nodeIds.has(id))
      : [...nodeIds];
  if (candidates.length === 0) return [];

  let seed = candidates[0]!;
  let bestFreq = -1;
  for (const id of candidates) {
    const f = opts.frequencyByNode(id);
    if (f > bestFreq) {
      bestFreq = f;
      seed = id;
    }
  }

  const outEdges = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target || !nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    let outs = outEdges.get(e.source);
    if (!outs) {
      outs = [];
      outEdges.set(e.source, outs);
    }
    outs.push(e.target);
  }

  const path: string[] = [seed];
  const visited = new Set<string>([seed]);
  let current = seed;
  for (;;) {
    const outs = outEdges.get(current) ?? [];
    let bestTarget: string | null = null;
    let bestEdgeFreq = -1;
    for (const target of outs) {
      if (visited.has(target)) continue;
      const f = opts.edgeFrequency(current, target);
      if (f > bestEdgeFreq) {
        bestEdgeFreq = f;
        bestTarget = target;
      }
    }
    if (bestTarget === null) break;
    path.push(bestTarget);
    visited.add(bestTarget);
    current = bestTarget;
    if (opts.endActivityIds.has(current)) break;
  }
  return path;
}

export async function dominantFlowLayout<
  TNodeData extends Record<string, unknown>,
  TEdgeData extends Record<string, unknown>,
>(
  nodes: Node<TNodeData>[],
  edges: Edge<TEdgeData>[],
  opts: DominantFlowOptions,
): Promise<{ nodes: Node<TNodeData>[]; edges: Edge<TEdgeData>[] }> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const path = findDominantPath(nodeIds, edges, opts);

  // spineTargets[source] = the node the spine continues to from `source`.
  const spineTargets = new Map<string, string>();
  for (let i = 0; i + 1 < path.length; i++) spineTargets.set(path[i]!, path[i + 1]!);

  const vertical = opts.direction === "DOWN";

  // Model order = temporal rank when available (keeps feedback edges pointing
  // backwards via MODEL_ORDER cycle breaking); otherwise frequency descending.
  const order = (id: string): number => {
    const r = opts.rankByNode(id);
    if (typeof r === "number" && !Number.isNaN(r)) return r;
    return 2 + 1 / (1 + Math.max(0, opts.frequencyByNode(id)));
  };

  return elkLayout(nodes, edges, {
    direction: opts.direction,
    edgeRouting: "ORTHOGONAL",
    celonisLike: true,
    defaultSize: opts.nodeSize,
    // Generous rank separation – edge labels sit on the between-layer
    // segments; in-layer spacing keeps siblings readable.
    nodeNodeBetweenLayers: vertical ? 90 : 120,
    nodeNode: vertical ? 56 : 48,
    nodeOrderHint: order,
    edgeOptions: (edge) =>
      spineTargets.get(edge.source) === edge.target
        ? {
            // Straightness priority is honoured by network-simplex node
            // placement: spine edges become one straight line on the flow axis.
            "elk.layered.priority.straightness": "10",
            // Preferred during cycle breaking + layering: spine edges point
            // with the flow and span exactly one layer where possible.
            "elk.layered.priority.direction": "10",
          }
        : undefined,
    extra: {
      // NETWORK_SIMPLEX honours per-edge straightness priorities (the default
      // Brandes-Köpf placer does not).
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.nodePlacement.favorStraightEdges": "true",
    },
  });
}
