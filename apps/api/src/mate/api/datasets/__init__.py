"""Server-side dataset layer (Phase 2).

A *dataset* is a module's named, typed data output. This package promotes the
Phase-1 client-side normalization to the server: it resolves a module dataset
to a canonical :class:`DatasetEnvelope`, applies transform chains over it
(DuckDB), and is reused by the flow engine (Phase 3) to execute module/transform
nodes. The envelope JSON intentionally matches the TS ``DatasetEnvelope`` shape
so the same generic-viz components render it.
"""
