import dagre from "@dagrejs/dagre";
import type { Graph } from "@/lib/schemas/graph";

const NODE_SIZE: Record<string, { width: number; height: number }> = {
  startEvent: { width: 60, height: 80 },
  endEvent: { width: 60, height: 80 },
  intermediateEvent: { width: 60, height: 80 },
  task: { width: 200, height: 72 },
  userTask: { width: 200, height: 72 },
  serviceTask: { width: 200, height: 72 },
  scriptTask: { width: 200, height: 72 },
  gateway: { width: 80, height: 100 },
  exclusiveGateway: { width: 80, height: 100 },
  parallelGateway: { width: 80, height: 100 },
  inclusiveGateway: { width: 80, height: 100 },
  subprocess: { width: 220, height: 96 },
};

const DEFAULT_SIZE = { width: 180, height: 72 };

export interface LayoutOptions {
  direction?: "LR" | "TB";
  nodeSeparation?: number;
  rankSeparation?: number;
}

export function layoutGraph(graph: Graph, options: LayoutOptions = {}): Graph {
  const { direction = "LR", nodeSeparation = 60, rankSeparation = 100 } = options;

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSeparation,
    ranksep: rankSeparation,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    const size = NODE_SIZE[node.type] ?? DEFAULT_SIZE;
    g.setNode(node.id, { width: size.width, height: size.height });
  }

  for (const edge of graph.edges) {
    g.setEdge(edge.source, edge.target, {}, edge.id);
  }

  dagre.layout(g);

  return {
    nodes: graph.nodes.map((node) => {
      const laid = g.node(node.id);
      if (!laid) return node;
      const size = NODE_SIZE[node.type] ?? DEFAULT_SIZE;
      return {
        ...node,
        position: {
          x: laid.x - size.width / 2,
          y: laid.y - size.height / 2,
        },
      };
    }),
    edges: graph.edges,
  };
}
