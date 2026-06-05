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
    Boolean,
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


class User(Base):
    """Local mirror of Keycloak users.

    Populated JIT on the first authenticated request from a new `sub`. The
    `id` column is the Keycloak `sub` claim (UUID) and the FK target for
    every per-user table below.
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str | None] = mapped_column(String(320))
    preferred_username: Mapped[str | None] = mapped_column(String(255))
    name: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=False
    )


class Folder(Base):
    """Hierarchical folder for organising event logs on /processes.

    Folders can nest arbitrarily; `parent_id` is null for top-level folders.
    `position` orders siblings within the same parent (lower = first).
    """

    __tablename__ = "process_folders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("process_folders.id", ondelete="CASCADE"),
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)

    __table_args__ = (Index("ix_process_folders_user_parent", "user_id", "parent_id"),)


class EventLog(Base):
    """A user-facing process log. The `id` is also the directory name in
    `data/event_logs/{id}/` and the URL identifier in `/processes/{logId}`.
    """

    __tablename__ = "process_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    source_format: Mapped[str | None] = mapped_column(String(32))
    source_filename: Mapped[str | None] = mapped_column(String(512))

    # The log's data model — the single isolation switch between case-centric
    # (XES/CSV/XML → events.parquet keyed by case_id) and object-centric (OCEL →
    # ocel/*.parquet). A log is exactly one model; the two never mix. Defaults to
    # "case_centric" so every pre-OCEL row stays case-centric.
    log_model: Mapped[str] = mapped_column(
        String(16), default="case_centric", server_default="case_centric", nullable=False
    )

    status: Mapped[str] = mapped_column(String(16), default="importing", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)

    events_count: Mapped[int | None] = mapped_column(Integer)
    # Case-centric counts — left NULL for object-centric logs (their NULLness is
    # itself a tell that the case-centric path never ran).
    cases_count: Mapped[int | None] = mapped_column(Integer)
    variants_count: Mapped[int | None] = mapped_column(Integer)
    # Object-centric counts — left NULL for case-centric logs.
    objects_count: Mapped[int | None] = mapped_column(Integer)
    object_types_count: Mapped[int | None] = mapped_column(Integer)
    relations_count: Mapped[int | None] = mapped_column(Integer)
    date_min: Mapped[datetime | None] = mapped_column(DateTime)
    date_max: Mapped[datetime | None] = mapped_column(DateTime)

    detected_schema: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    # Resolved canonical column mapping: role ("case_id"/"activity"/"timestamp"/
    # optional) → the source column it was taken from. Set by the importer and
    # editable from the log's settings ("Column roles"), which re-imports.
    column_roles: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # True when the importer had to *guess* one of the mandatory roles (a fuzzy
    # or type-based match, not an exact header). Surfaces a "review mapping"
    # warning in the process overview until the user confirms it in settings.
    mapping_needs_review: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    description: Mapped[str | None] = mapped_column(Text)
    column_overrides: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # Applied Events-tab filter: a JSON array of {field, op, value?} entries.
    # NULL/[] means the full dataset. Every non-editor consumer (Variants /
    # Activities / Data-quality and all modules) reads through this overlay.
    active_filter: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)

    folder_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("process_folders.id", ondelete="SET NULL"),
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    imported_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_edited_at: Mapped[datetime | None] = mapped_column(DateTime)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)

    __table_args__ = (
        Index("ix_process_logs_user_status", "user_id", "status"),
        Index("ix_process_logs_user_created_at", "user_id", "created_at"),
        Index("ix_process_logs_user_folder_id", "user_id", "folder_id"),
    )


class Job(Base):
    """Persisted job — see §7.9.5 / §8.

    The drawer / dock / toasts in the frontend (phase 4 and beyond) read from
    this table; for phase 3 only `import` jobs are produced.
    """

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
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
        Index("ix_jobs_user_status", "user_id", "status"),
        Index("ix_jobs_user_type", "user_id", "type"),
        Index("ix_jobs_user_module", "user_id", "module_id"),
        Index("ix_jobs_user_created_at", "user_id", "created_at"),
    )


class ModuleConfig(Base):
    """Per-module per-user configuration — populated by Settings → Modules."""

    __tablename__ = "module_configs"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    module_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    enabled: Mapped[bool] = mapped_column(default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=False
    )


class ModuleInstall(Base):
    """Per-user record of which modules a user has installed / made available.

    Module *code* lives once on shared disk (``modules/<id>/``) and is loaded
    once into the process — true per-user code isolation is out of scope. This
    table reference-counts *ownership* so listing, availability, and deletion
    are per-user: a user only sees and can manage modules they installed, and
    the on-disk artifact is removed only when its last owner uninstalls it.
    """

    __tablename__ = "module_installs"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    module_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source: Mapped[str | None] = mapped_column(String(16))
    installed_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)

    __table_args__ = (Index("ix_module_installs_module_id", "module_id"),)


class ModuleLayout(Base):
    """Per-user, per-(log, module) widget layout."""

    __tablename__ = "module_layouts"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
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
    """Free-form per-user key/value settings (Settings → General, AI, Privacy)."""

    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
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
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
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

    __table_args__ = (Index("ix_event_edits_user_log_edited_at", "user_id", "log_id", "edited_at"),)


class AnalyticsSession(Base):
    """Aggregate row per browser session — one per visit/idle-timeout window.

    Updated via UPSERT on each ingested batch so `GET /analytics/summary` can
    answer "sessions in the last 30 days" without scanning the events table.
    """

    __tablename__ = "analytics_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    anon_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    entry_path: Mapped[str | None] = mapped_column(String(512))
    event_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        Index("ix_analytics_sessions_user_anon", "user_id", "anon_user_id"),
        Index("ix_analytics_sessions_user_last_seen", "user_id", "last_seen_at"),
    )


class AnalyticsEvent(Base):
    """Append-only behaviour-tracking event row.

    Capture is gated by the ``analytics.config`` UserSetting on both client
    and server. No PII is stored — see ``routes/analytics.py`` for the
    server-side enabled-gate and the explicit "never capture" list in the
    Privacy settings copy.
    """

    __tablename__ = "analytics_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    session_id: Mapped[str] = mapped_column(String(36), nullable=False)
    anon_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    # "client" for browser-emitted events (clicks, page views, web-vitals);
    # "server" for backend-emitted ones (business-op timings, job outcomes).
    source: Mapped[str] = mapped_column(
        String(16), default="client", server_default="client", nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    event_name: Mapped[str] = mapped_column(String(128), nullable=False)
    # Wall-clock duration in ms for timed server events (request handling, job
    # runtime). Null for instantaneous client events.
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    path: Mapped[str | None] = mapped_column(String(512))
    referrer: Mapped[str | None] = mapped_column(String(512))
    properties: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    viewport_w: Mapped[int | None] = mapped_column(Integer)
    viewport_h: Mapped[int | None] = mapped_column(Integer)
    ua_class: Mapped[str | None] = mapped_column(String(32))
    locale: Mapped[str | None] = mapped_column(String(16))
    tz: Mapped[str | None] = mapped_column(String(64))
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    server_received_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)

    __table_args__ = (
        Index("ix_analytics_events_user_session", "user_id", "session_id", "occurred_at"),
        Index("ix_analytics_events_user_type_name", "user_id", "event_type", "event_name"),
        Index("ix_analytics_events_user_occurred", "user_id", "occurred_at"),
    )


class Dashboard(Base):
    """A user-built dashboard: a grid of cards drawn from any installed module.

    A dashboard binds to a single event log (`event_log_id`); every card on it
    renders against that log. `layout_json` holds the full board state — the
    placed cards and their react-grid-layout geometry — as::

        {"items": [{"i": "<uuid>", "module_id": "...", "widget_id": "...",
                    "title": "...", "x": 0, "y": 0, "w": 6, "h": 8,
                    "config": {}}]}

    Storing cards + geometry in one blob keeps a save atomic and makes the
    export/import payload a straight passthrough. The bound log is nulled (not
    cascade-deleted) when the log goes away so the board survives as a shell.
    """

    __tablename__ = "dashboards"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    event_log_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("process_logs.id", ondelete="SET NULL")
    )
    layout_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=False
    )

    __table_args__ = (Index("ix_dashboards_user_created_at", "user_id", "created_at"),)
