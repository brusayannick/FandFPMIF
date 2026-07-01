"""Pydantic schemas for /api/v1/flows (the node-graph builder).

A flow is a node graph (``source -> module -> transform -> viz``) bound to one
event log. The graph (nodes + edges) round-trips through ``FlowGraph`` as one
atomic ``graph_json`` blob, mirroring how a dashboard stores its ``layout_json``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from mate.api.schemas.event_logs import LogModel

NodeType = Literal["source", "module", "transform", "viz"]


class FlowNode(BaseModel):
    """One node. ``data`` is type-specific and opaque to the backend except where
    the engine reads it:
      * source    - visual anchor for the bound event log (no data needed).
      * module    - ``{module_id, dataset_id}`` -> produces that dataset.
      * transform - ``{transform: {op, ...}}`` -> one shaping step on its input.
      * viz       - ``{viz_id, mapping, config}`` -> renders its input (frontend).
    """

    id: str
    type: NodeType
    position: dict[str, float] = Field(default_factory=lambda: {"x": 0.0, "y": 0.0})
    data: dict[str, Any] = Field(default_factory=dict)


class FlowEdge(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: str | None = None  # noqa: N815 - React Flow edge field
    targetHandle: str | None = None  # noqa: N815 - React Flow edge field


class FlowGraph(BaseModel):
    nodes: list[FlowNode] = Field(default_factory=list)
    edges: list[FlowEdge] = Field(default_factory=list)


class FlowSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None = None
    event_log_id: str | None = None
    log_model: LogModel = "case_centric"
    node_count: int = 0
    updated_at: datetime


class FlowDetail(BaseModel):
    id: str
    name: str
    description: str | None = None
    event_log_id: str | None = None
    log_model: LogModel = "case_centric"
    graph: FlowGraph = Field(default_factory=FlowGraph)
    created_at: datetime
    updated_at: datetime
    is_owner: bool = True


class FlowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    event_log_id: str | None = None
    log_model: LogModel = "case_centric"
    graph: FlowGraph = Field(default_factory=FlowGraph)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Name cannot be empty.")
        return cleaned


class FlowUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    event_log_id: str | None = None
    graph: FlowGraph | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Name cannot be empty.")
        return cleaned
