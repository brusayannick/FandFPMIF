"""SQLAlchemy ORM models for the metadata SQLite database.

Schema follows INSTRUCTIONS.md §7.9.5 (Job model fields) and §3.3 (process logs
metadata). Module-related tables are scaffolded here even though they are
populated by phase 5 — the column shape is fixed in v1.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON}


class EventLog(Base):
    """A user-facing process log. The `id` is also the directory name in
    `data/event_logs/{id}/` and the URL identifier in `/processes/{logId}`.
    """

    __tablename__ = "process_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    source_format: Mapped[str | None] = mapped_column(String(32))
    source_filename: Mapped[str | None] = mapped_column(String(512))

    status: Mapped[str] = mapped_column(String(16), default="importing", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)

    events_count: Mapped[int | None] = mapped_column(Integer)
    cases_count: Mapped[int | None] = mapped_column(Integer)
    variants_count: Mapped[int | None] = mapped_column(Integer)
    date_min: Mapped[datetime | None] = mapped_column(DateTime)
    date_max: Mapped[datetime | None] = mapped_column(DateTime)

    detected_schema: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    description: Mapped[str | None] = mapped_column(Text)
    column_overrides: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    imported_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_edited_at: Mapped[datetime | None] = mapped_column(DateTime)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)

    __table_args__ = (
        Index("ix_process_logs_status", "status"),
        Index("ix_process_logs_created_at", "created_at"),
    )


class Job(Base):
    """Persisted job — see §7.9.5 / §8.

    The drawer / dock / toasts in the frontend (phase 4 and beyond) read from
    this table; for phase 3 only `import` jobs are produced.
    """

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    type: Mapped[str] = mapped_column(String(64), nullable=False)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(255))
    module_id: Mapped[str | None] = mapped_column(String(64))

    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    progress_current: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    progress_total: Mapped[int | None] = mapped_column(Integer)
    stage: Mapped[str | None] = mapped_column(String(64))
    message: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)

    rate: Mapped[float | None] = mapped_column()
    eta_seconds: Mapped[float | None] = mapped_column()
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    parent_job_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("jobs.id", ondelete="SET NULL")
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)

    __table_args__ = (
        Index("ix_jobs_status", "status"),
        Index("ix_jobs_type", "type"),
        Index("ix_jobs_module_id", "module_id"),
        Index("ix_jobs_created_at", "created_at"),
    )


class ModuleConfig(Base):
    """Per-module user configuration — populated by phase 5 / Settings → Modules."""

    __tablename__ = "module_configs"

    module_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    enabled: Mapped[bool] = mapped_column(default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=False
    )


class ModuleLayout(Base):
    """Per-user, per-(log, module) widget layout."""

    __tablename__ = "module_layouts"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True, default="local")
    log_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("process_logs.id", ondelete="CASCADE"),
        primary_key=True,
    )
    module_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    layout_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=False
    )


class UserSetting(Base):
    """Free-form key/value settings (Settings → General)."""

    __tablename__ = "user_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value_json: Mapped[dict[str, Any] | list[Any] | str | int | float | bool | None] = (
        mapped_column(JSON)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=False
    )


class EventEdit(Base):
    """Audit trail for manual cell edits made via the Events tab.

    Each row records one field change. We never delete rows from this table —
    Settings → Edit history surfaces the most recent N for a given log.
    """

    __tablename__ = "event_edits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    log_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("process_logs.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    field: Mapped[str] = mapped_column(String(128), nullable=False)
    old_value_json: Mapped[Any] = mapped_column(JSON)
    new_value_json: Mapped[Any] = mapped_column(JSON)
    edited_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)

    __table_args__ = (
        Index("ix_event_edits_log_id_edited_at", "log_id", "edited_at"),
    )
