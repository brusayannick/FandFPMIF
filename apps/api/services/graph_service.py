from __future__ import annotations

from collections import defaultdict, deque

from schemas.graph import GraphSchema, ValidationResult


class GraphValidationError(ValueError):
    """Raised when a process graph fails structural validation."""


def validate_dag(graph: GraphSchema, *, strict: bool = False) -> ValidationResult:
    """Validate that a process graph is a proper DAG with start/end events.

    With ``strict=False`` (default), missing start/end events downgrade to
    warnings so that a graph being built up on the canvas can still be saved.
    ``strict=True`` is used when the graph must be runnable (e.g. simulation).
    """

    warnings: list[str] = []
    node_ids = {n.id for n in graph.nodes}

    for edge in graph.edges:
        if edge.source not in node_ids:
            raise GraphValidationError(
                f"Edge {edge.id!r} references unknown source node {edge.source!r}"
            )
        if edge.target not in node_ids:
            raise GraphValidationError(
                f"Edge {edge.id!r} references unknown target node {edge.target!r}"
            )

    adjacency: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = {nid: 0 for nid in node_ids}
    for edge in graph.edges:
        adjacency[edge.source].append(edge.target)
        in_degree[edge.target] += 1

    queue: deque[str] = deque(
        nid for nid, deg in in_degree.items() if deg == 0
    )
    visited = 0
    while queue:
        node_id = queue.popleft()
        visited += 1
        for neighbour in adjacency[node_id]:
            in_degree[neighbour] -= 1
            if in_degree[neighbour] == 0:
                queue.append(neighbour)

    if graph.nodes and visited != len(graph.nodes):
        raise GraphValidationError("Process graph contains a cycle.")

    start_events = [n for n in graph.nodes if n.type == "startEvent"]
    end_events = [n for n in graph.nodes if n.type == "endEvent"]

    if not start_events:
        msg = "Graph has no start event."
        if strict:
            raise GraphValidationError(msg)
        warnings.append(msg)
    if not end_events:
        msg = "Graph has no end event."
        if strict:
            raise GraphValidationError(msg)
        warnings.append(msg)

    connected_ids: set[str] = set()
    for edge in graph.edges:
        connected_ids.add(edge.source)
        connected_ids.add(edge.target)
    orphans = [n.id for n in graph.nodes if n.id not in connected_ids]
    if len(graph.nodes) > 1 and orphans:
        warnings.append(
            f"{len(orphans)} node(s) are not connected to the graph: "
            + ", ".join(orphans[:5])
            + ("…" if len(orphans) > 5 else "")
        )

    return ValidationResult(
        valid=True,
        node_count=len(graph.nodes),
        edge_count=len(graph.edges),
        warnings=warnings,
    )
