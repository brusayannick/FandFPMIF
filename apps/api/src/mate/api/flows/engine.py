"""Flow graph execution (Phase 3).

:func:`resolve_node` computes the :class:`DatasetEnvelope` a node produces by
recursively resolving its (single) upstream input:

  * module    -> :func:`resolve_dataset` for ``{module_id, dataset_id}`` on the
                 flow's log.
  * transform -> :func:`apply_transforms` of the node's one ``transform`` step
                 over its input.
  * viz       -> its input, unchanged (the viz config is rendered frontend-side).

On-demand + cache-backed (each module route caches its own result), so it powers
both the editor's live node previews and ``kind:"flow"`` dashboard cards without
a standing job. A heavy whole-DAG precompute (``flow.run``) can layer on top
later; the single-node path is the primitive everything else reuses.
"""

from __future__ import annotations

from typing import Any

from mate.api.datasets.adapters import resolve_dataset
from mate.api.datasets.envelope import DatasetEnvelope
from mate.api.datasets.transforms import apply_transforms, join_envelopes


class FlowExecutionError(ValueError):
    """A flow graph that can't be executed (missing input, unknown node, cycle,
    or a node type that yields no dataset)."""


def _incoming(graph: dict[str, Any]) -> dict[str, list[str]]:
    inc: dict[str, list[str]] = {}
    for e in graph.get("edges") or []:
        src, tgt = e.get("source"), e.get("target")
        if src and tgt:
            inc.setdefault(tgt, []).append(src)
    return inc


async def resolve_node(
    loader: Any,
    graph: dict[str, Any],
    node_id: str,
    log_id: str,
    user_id: str,
    *,
    filter_override: list[dict[str, Any]] | None = None,
) -> DatasetEnvelope:
    """Resolve the envelope produced by ``node_id`` in ``graph``."""
    nodes = {n.get("id"): n for n in (graph.get("nodes") or [])}
    incoming = _incoming(graph)

    async def _resolve(nid: str, path: frozenset[str]) -> DatasetEnvelope:
        if nid in path:
            raise FlowExecutionError("Flow has a cycle.")
        node = nodes.get(nid)
        if node is None:
            raise FlowExecutionError(f"Unknown node {nid!r}.")
        ntype = node.get("type")
        data = node.get("data") or {}

        if ntype == "module":
            module_id = data.get("module_id")
            dataset_id = data.get("dataset_id")
            if not module_id or not dataset_id:
                raise FlowExecutionError("Module node needs a module and a dataset.")
            return await resolve_dataset(
                loader, module_id, dataset_id, log_id, user_id, filter_override=filter_override
            )

        if ntype == "transform":
            ups = incoming.get(nid) or []
            if not ups:
                raise FlowExecutionError("Transform node has no input - connect a source.")
            step = data.get("transform")
            if step and step.get("op") == "join":
                if len(ups) < 2:
                    raise FlowExecutionError("Join needs two inputs - connect two datasets.")
                left = await _resolve(ups[0], path | {nid})
                right = await _resolve(ups[1], path | {nid})
                return join_envelopes(left, right, step)
            up_env = await _resolve(ups[0], path | {nid})
            return apply_transforms(up_env, [step] if step else [])

        if ntype == "viz":
            ups = incoming.get(nid) or []
            if not ups:
                raise FlowExecutionError("Visualization node has no input - connect a dataset.")
            return await _resolve(ups[0], path | {nid})

        raise FlowExecutionError(
            f"Node type {ntype!r} produces no dataset - connect a module or transform node."
        )

    return await _resolve(node_id, frozenset())
