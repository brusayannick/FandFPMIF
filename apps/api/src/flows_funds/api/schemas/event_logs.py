"""Pydantic v2 schemas for the /event-logs API surface.

Mirrors INSTRUCTIONS.md §6 and §3.2 — `id` is a UUID v7 string, status is one
of {importing, ready, failed}.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

EventLogStatus = Literal["importing", "ready", "failed"]
SourceFormat = Literal["xes", "xes.gz", "csv", "xml", "ocel"]


class CsvColumnMapping(BaseModel):
    """Mapping from CSV columns to canonical event log fields. The frontend
    column-mapping wizard (phase 7) submits this alongside the upload; for now
    it is also accepted directly via the API.
    """

    case_id: str
    activity: str
    timestamp: str
    end_timestamp: str | None = None
    resource: str | None = None
    cost: str | None = None
    delimiter: str | None = ","
    timestamp_format: str | None = None
    extra: dict[str, str] = Field(default_factory=dict)


class ImportPayload(BaseModel):
    """Optional metadata sent alongside a multipart upload (form-encoded JSON)."""

    name: str | None = None
    csv_mapping: CsvColumnMapping | None = None


class EventLogCreateResponse(BaseModel):
    log_id: str
    job_id: str


class EventLogSummary(BaseModel):
    """Row shape for `GET /event-logs`."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    status: EventLogStatus | str
    source_format: str | None = None
    source_filename: str | None = None
    events_count: int | None = None
    cases_count: int | None = None
    variants_count: int | None = None
    date_min: datetime | None = None
    date_max: datetime | None = None
    error: str | None = None
    created_at: datetime
    imported_at: datetime | None = None
    last_edited_at: datetime | None = None


class EventLogDetail(EventLogSummary):
    detected_schema: dict[str, Any] | None = None
    description: str | None = None
    column_overrides: dict[str, Any] | None = None


class EventLogUpdate(BaseModel):
    """Mutable fields on an existing log: display name, free-text notes,
    per-column display overrides (label / order / hidden, see Settings tab).
    """

    name: str | None = None
    description: str | None = None
    column_overrides: dict[str, Any] | None = None
