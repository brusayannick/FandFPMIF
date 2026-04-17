from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

from schemas.graph import GraphSchema


class ProcessCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class ProcessUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class ProcessSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    node_count: int
    edge_count: int
    created_at: datetime
    updated_at: datetime


class ProcessDetail(ProcessSummary):
    graph: GraphSchema


class ProcessSaveGraph(BaseModel):
    graph: GraphSchema


class ProcessSaveResponse(BaseModel):
    id: str
    node_count: int
    edge_count: int
    updated_at: datetime
    validation_warnings: list[str] = Field(default_factory=list)


class ModuleManifest(BaseModel):
    module_id: str
    display_name: str
    version: str
    description: str | None = None
    config_schema: dict | None = None


class ModuleList(BaseModel):
    modules: list[ModuleManifest]


class ModuleConfigResponse(BaseModel):
    module_id: str
    config: dict
    enabled: bool
    updated_at: datetime | None = None


class ModuleConfigUpdate(BaseModel):
    config: dict
    enabled: bool = True
