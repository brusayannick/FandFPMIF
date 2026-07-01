"""The node-graph builder (Phase 3): execution engine over a flow's graph_json.

A flow wires ``source -> module -> transform -> viz`` nodes. The engine resolves
any node to a :class:`DatasetEnvelope` by walking its upstream chain - module
nodes via :func:`resolve_dataset`, transform nodes via :func:`apply_transforms`,
viz nodes pass their input through (the visualization is rendered frontend-side).
"""
