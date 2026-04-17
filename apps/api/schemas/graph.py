from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


NodeKind = Literal[
    "startEvent",
    "endEvent",
    "intermediateEvent",
    "task",
    "userTask",
    "serviceTask",
    "scriptTask",
    "gateway",
    "exclusiveGateway",
    "parallelGateway",
    "inclusiveGateway",
    "subprocess",
]


class Position(BaseModel):
    x: float
    y: float


class NodeData(BaseModel):
    model_config = ConfigDict(extra="allow")

    label: str
    description: str | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    assignee: str | None = None
    cost: float | None = Field(default=None, ge=0)
    status: Literal["idle", "active", "blocked", "done"] = "idle"


class NodeSchema(BaseModel):
    id: str
    type: NodeKind
    position: Position
    data: NodeData
    width: float | None = None
    height: float | None = None


class EdgeSchema(BaseModel):
    id: str
    source: str
    target: str
    source_handle: str | None = Field(default=None, alias="sourceHandle")
    target_handle: str | None = Field(default=None, alias="targetHandle")
    label: str | None = None
    data: dict[str, Any] | None = None
    animated: bool = False

    model_config = ConfigDict(populate_by_name=True)


class GraphSchema(BaseModel):
    nodes: list[NodeSchema] = Field(default_factory=list)
    edges: list[EdgeSchema] = Field(default_factory=list)


class ValidationResult(BaseModel):
    valid: bool
    node_count: int
    edge_count: int
    warnings: list[str] = Field(default_factory=list)
