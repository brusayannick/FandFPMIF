"""Pydantic request/response schemas for /api/v1/dashboards.

A dashboard is a grid of cards (each `(module_id, widget_id)`) bound to one
event log. The placed cards and their react-grid-layout geometry travel
together as a list of `DashboardItem` so a save is one atomic write and the
export payload is a straight passthrough.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DashboardItem(BaseModel):
    """One placed card and its grid geometry (12-column react-grid-layout)."""

    i: str  # stable client id for this placement
    module_id: str
    widget_id: str
    title: str | None = None
    x: int = 0
    y: int = 0
    w: int = Field(default=6, ge=1, le=12)
    h: int = Field(default=8, ge=1, le=48)
    # Per-placement card options (e.g. which metric a chart shows). Opaque to
    # the backend; the widget interprets it.
    config: dict[str, Any] = Field(default_factory=dict)


class DashboardSummary(BaseModel):
    """List-view row — no card payload, just enough for the grid of boards."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None = None
    event_log_id: str | None = None
    card_count: int = 0
    updated_at: datetime


class DashboardDetail(BaseModel):
    id: str
    name: str
    description: str | None = None
    event_log_id: str | None = None
    items: list[DashboardItem] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class DashboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    event_log_id: str | None = None
    items: list[DashboardItem] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Name cannot be empty.")
        return cleaned


class DashboardUpdate(BaseModel):
    """Partial update — only fields present in the body are touched. `items`
    and `event_log_id` are nullable+present-aware so a board can be cleared or
    unbound from its log explicitly."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    event_log_id: str | None = None
    items: list[DashboardItem] | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Name cannot be empty.")
        return cleaned


class DashboardExport(BaseModel):
    """Portable, id-free representation for download / re-import."""

    kind: str = "mate.dashboard"
    version: int = 1
    name: str
    description: str | None = None
    items: list[DashboardItem] = Field(default_factory=list)


class DashboardImport(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    items: list[DashboardItem] = Field(default_factory=list)
    event_log_id: str | None = None
