"""/api/v1/admin/insights — read-only cross-user dashboards for admins.

Two capabilities, both gated by the Keycloak ``admin`` role (they read every
user's metadata — accounts, imported logs, job outcomes, usage analytics):

* ``GET /admin/insights/overview`` — KPIs + time series for an admin dashboard
  spanning platform data (users/logs), job-runtime health, and usage analytics.
* ``GET /admin/insights/event-logs`` — a paginated, searchable listing of every
  user's imported event logs joined to the owning user.

Everything here is a pure read aggregation over existing tables — no schema and
no cross-user mutations. The event-bus ``user_id`` tenant-isolation invariant
does not apply: these are deliberately cross-user, admin-gated REST reads.

See ``apps/web/app/(platform)/admin/overview`` and ``.../admin/logs`` for the UI.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import structlog
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.engine import Row

from mate.api.auth import AdminUserDep
from mate.api.db.models import AnalyticsEvent, AnalyticsSession, EventLog, Job, User
from mate.api.db.session import SessionDep
from mate.api.ingest.storage import log_paths
from mate.api.storage import sync as storage_sync

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/admin/insights", tags=["admin"])


# --------------------------------------------------------------------------
# Overview
# --------------------------------------------------------------------------


class Kpis(BaseModel):
    user_count: int
    log_count: int
    events_ingested: int
    cases_total: int
    analytics_events: int
    sessions_total: int
    active_users_30d: int
    events_per_session: int
    bounce_rate_pct: int
    avg_session_seconds: int


class DayCount(BaseModel):
    day: str  # "YYYY-MM-DD"
    count: int


class LabelCount(BaseModel):
    label: str
    count: int


class TopUser(BaseModel):
    user_id: str
    email: str | None
    username: str | None
    count: int


class AdminOverview(BaseModel):
    days: int
    kpis: Kpis
    signups_by_day: list[DayCount]
    logs_by_day: list[DayCount]
    logs_by_status: list[LabelCount]
    logs_by_format: list[LabelCount]
    logs_by_model: list[LabelCount]
    top_users: list[TopUser]
    jobs_by_status: list[LabelCount]
    job_failures_by_day: list[DayCount]
    sessions_by_day: list[DayCount]
    top_event_types: list[LabelCount]
    top_paths: list[LabelCount]
    activity_by_hour: list[LabelCount]
    activity_by_weekday: list[LabelCount]


def _naive_utc_now() -> datetime:
    """Now as a naive UTC datetime — every timestamp column is stored this way."""
    return datetime.now(UTC).replace(tzinfo=None)


def _day_series(rows: Sequence[Row[Any]]) -> list[DayCount]:
    """Coerce ``(date_str, count)`` rows into a sorted day series."""
    return [DayCount(day=str(d), count=int(c)) for d, c in rows if d is not None]


def _labels(rows: Sequence[Row[Any]], *, unknown: str = "unknown") -> list[LabelCount]:
    """Coerce ``(label, count)`` rows; ``None`` labels become ``unknown``."""
    return [
        LabelCount(label=str(label) if label is not None else unknown, count=int(c))
        for label, c in rows
    ]


# strftime('%w'): 0=Sunday..6=Saturday. Render the weekday chart Monday-first.
_WEEKDAYS: tuple[tuple[str, str], ...] = (
    ("1", "Mon"),
    ("2", "Tue"),
    ("3", "Wed"),
    ("4", "Thu"),
    ("5", "Fri"),
    ("6", "Sat"),
    ("0", "Sun"),
)


@router.get("/overview", response_model=AdminOverview)
async def overview(user: AdminUserDep, session: SessionDep, days: int = 90) -> AdminOverview:
    """KPIs and time series for the admin dashboard, across all users.

    ``days`` (clamped to 1..365) bounds every time series. Active-user count is
    fixed to the last 30 days regardless of ``days`` so the KPI stays stable.
    """
    days = max(1, min(days, 365))
    cutoff = _naive_utc_now() - timedelta(days=days)
    sess_cutoff = _naive_utc_now() - timedelta(days=30)

    live_logs = EventLog.deleted_at.is_(None)

    # Session-derived engagement metrics (all-time, like ``sessions_total``).
    sessions_total = int(
        await session.scalar(select(func.count()).select_from(AnalyticsSession)) or 0
    )
    bounce_sessions = int(
        await session.scalar(
            select(func.count())
            .select_from(AnalyticsSession)
            .where(AnalyticsSession.event_count <= 1)
        )
        or 0
    )
    avg_events_per_session = float(
        await session.scalar(select(func.avg(AnalyticsSession.event_count))) or 0.0
    )
    # SQLite stores timestamps as naive-UTC text; julianday() diff yields
    # fractional days, times 86400 for seconds. NULL coalesces to 0.0 with no sessions.
    avg_session_seconds = float(
        await session.scalar(
            select(
                func.avg(
                    (
                        func.julianday(AnalyticsSession.last_seen_at)
                        - func.julianday(AnalyticsSession.started_at)
                    )
                    * 86400.0
                )
            )
        )
        or 0.0
    )

    kpis = Kpis(
        user_count=int(await session.scalar(select(func.count()).select_from(User)) or 0),
        log_count=int(
            await session.scalar(select(func.count()).select_from(EventLog).where(live_logs)) or 0
        ),
        events_ingested=int(
            await session.scalar(
                select(func.coalesce(func.sum(EventLog.events_count), 0)).where(live_logs)
            )
            or 0
        ),
        cases_total=int(
            await session.scalar(
                select(func.coalesce(func.sum(EventLog.cases_count), 0)).where(live_logs)
            )
            or 0
        ),
        analytics_events=int(
            await session.scalar(select(func.count()).select_from(AnalyticsEvent)) or 0
        ),
        sessions_total=sessions_total,
        active_users_30d=int(
            await session.scalar(
                select(func.count(func.distinct(AnalyticsSession.user_id))).where(
                    AnalyticsSession.last_seen_at >= sess_cutoff
                )
            )
            or 0
        ),
        events_per_session=round(avg_events_per_session),
        bounce_rate_pct=round(100 * bounce_sessions / sessions_total) if sessions_total else 0,
        avg_session_seconds=round(avg_session_seconds),
    )

    signups = _day_series(
        (
            await session.execute(
                select(func.date(User.created_at), func.count())
                .where(User.created_at >= cutoff)
                .group_by(func.date(User.created_at))
                .order_by(func.date(User.created_at))
            )
        ).all()
    )
    logs_by_day = _day_series(
        (
            await session.execute(
                select(func.date(EventLog.created_at), func.count())
                .where(live_logs, EventLog.created_at >= cutoff)
                .group_by(func.date(EventLog.created_at))
                .order_by(func.date(EventLog.created_at))
            )
        ).all()
    )

    logs_by_status = _labels(
        (
            await session.execute(
                select(EventLog.status, func.count())
                .where(live_logs)
                .group_by(EventLog.status)
                .order_by(func.count().desc())
            )
        ).all()
    )
    logs_by_format = _labels(
        (
            await session.execute(
                select(EventLog.source_format, func.count())
                .where(live_logs)
                .group_by(EventLog.source_format)
                .order_by(func.count().desc())
            )
        ).all()
    )
    logs_by_model = _labels(
        (
            await session.execute(
                select(EventLog.log_model, func.count())
                .where(live_logs)
                .group_by(EventLog.log_model)
                .order_by(func.count().desc())
            )
        ).all()
    )

    top_users = [
        TopUser(user_id=str(uid), email=email, username=username, count=int(c))
        for uid, email, username, c in (
            await session.execute(
                select(User.id, User.email, User.preferred_username, func.count(EventLog.id))
                .join(EventLog, EventLog.user_id == User.id)
                .where(live_logs)
                .group_by(User.id, User.email, User.preferred_username)
                .order_by(func.count(EventLog.id).desc())
                .limit(10)
            )
        ).all()
    ]

    jobs_by_status = _labels(
        (
            await session.execute(
                select(Job.status, func.count()).group_by(Job.status).order_by(func.count().desc())
            )
        ).all()
    )
    job_failures = _day_series(
        (
            await session.execute(
                select(func.date(Job.finished_at), func.count())
                .where(
                    Job.status == "failed",
                    Job.finished_at.is_not(None),
                    Job.finished_at >= cutoff,
                )
                .group_by(func.date(Job.finished_at))
                .order_by(func.date(Job.finished_at))
            )
        ).all()
    )

    sessions_by_day = _day_series(
        (
            await session.execute(
                select(func.date(AnalyticsSession.started_at), func.count())
                .where(AnalyticsSession.started_at >= cutoff)
                .group_by(func.date(AnalyticsSession.started_at))
                .order_by(func.date(AnalyticsSession.started_at))
            )
        ).all()
    )
    top_event_types = _labels(
        (
            await session.execute(
                select(AnalyticsEvent.event_type, func.count())
                .group_by(AnalyticsEvent.event_type)
                .order_by(func.count().desc())
                .limit(10)
            )
        ).all()
    )

    # Behavioural breakdowns, windowed by ``cutoff`` so the range selector
    # applies. Hours are UTC (occurred_at is stored naive-UTC).
    top_paths = _labels(
        (
            await session.execute(
                select(AnalyticsEvent.path, func.count())
                .where(
                    AnalyticsEvent.event_type == "page",
                    AnalyticsEvent.path.is_not(None),
                    AnalyticsEvent.occurred_at >= cutoff,
                )
                .group_by(AnalyticsEvent.path)
                .order_by(func.count().desc())
                .limit(10)
            )
        ).all()
    )
    activity_by_hour = [
        LabelCount(label=str(h), count=int(c))
        for h, c in (
            await session.execute(
                select(func.strftime("%H", AnalyticsEvent.occurred_at), func.count())
                .where(AnalyticsEvent.occurred_at >= cutoff)
                .group_by(func.strftime("%H", AnalyticsEvent.occurred_at))
                .order_by(func.strftime("%H", AnalyticsEvent.occurred_at))
            )
        ).all()
        if h is not None
    ]
    weekday_counts = {
        str(w): int(c)
        for w, c in (
            await session.execute(
                select(func.strftime("%w", AnalyticsEvent.occurred_at), func.count())
                .where(AnalyticsEvent.occurred_at >= cutoff)
                .group_by(func.strftime("%w", AnalyticsEvent.occurred_at))
            )
        ).all()
        if w is not None
    }
    activity_by_weekday = [
        LabelCount(label=name, count=weekday_counts.get(num, 0)) for num, name in _WEEKDAYS
    ]

    return AdminOverview(
        days=days,
        kpis=kpis,
        signups_by_day=signups,
        logs_by_day=logs_by_day,
        logs_by_status=logs_by_status,
        logs_by_format=logs_by_format,
        logs_by_model=logs_by_model,
        top_users=top_users,
        jobs_by_status=jobs_by_status,
        job_failures_by_day=job_failures,
        sessions_by_day=sessions_by_day,
        top_event_types=top_event_types,
        top_paths=top_paths,
        activity_by_hour=activity_by_hour,
        activity_by_weekday=activity_by_weekday,
    )


# --------------------------------------------------------------------------
# Cross-user event-log listing
# --------------------------------------------------------------------------


class AdminLogRow(BaseModel):
    id: str
    name: str
    owner_id: str
    owner_email: str | None
    owner_username: str | None
    status: str
    source_format: str | None
    log_model: str
    events_count: int | None
    cases_count: int | None
    objects_count: int | None
    date_min: datetime | None
    date_max: datetime | None
    created_at: datetime
    imported_at: datetime | None
    folder_id: str | None


class AdminLogList(BaseModel):
    total: int
    items: list[AdminLogRow]


_SORT_COLS = {
    "created_at": EventLog.created_at,
    "imported_at": EventLog.imported_at,
    "name": EventLog.name,
    "events_count": EventLog.events_count,
}


@router.get("/event-logs", response_model=AdminLogList)
async def event_logs(
    user: AdminUserDep,
    session: SessionDep,
    q: str | None = None,
    status: str | None = None,
    sort: Literal["created_at", "imported_at", "name", "events_count"] = "created_at",
    order: Literal["asc", "desc"] = "desc",
    limit: int = 50,
    offset: int = 0,
) -> AdminLogList:
    """List every (non-deleted) event log across all users with its owner.

    ``q`` matches the log name or the owner's email/username (case-insensitive).
    Read-only — there are no mutate-other-users'-logs endpoints by design.
    """
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    filters: list[ColumnElement[bool]] = [EventLog.deleted_at.is_(None)]
    if q:
        like = f"%{q}%"
        filters.append(
            or_(
                EventLog.name.ilike(like),
                User.email.ilike(like),
                User.preferred_username.ilike(like),
            )
        )
    if status:
        filters.append(EventLog.status == status)

    total = int(
        await session.scalar(
            select(func.count())
            .select_from(EventLog)
            .join(User, EventLog.user_id == User.id)
            .where(*filters)
        )
        or 0
    )

    sort_col = _SORT_COLS[sort]
    ordering = sort_col.asc() if order == "asc" else sort_col.desc()

    rows = (
        await session.execute(
            select(EventLog, User)
            .join(User, EventLog.user_id == User.id)
            .where(*filters)
            .order_by(ordering, EventLog.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()

    items = [
        AdminLogRow(
            id=ev.id,
            name=ev.name,
            owner_id=owner.id,
            owner_email=owner.email,
            owner_username=owner.preferred_username,
            status=ev.status,
            source_format=ev.source_format,
            log_model=ev.log_model,
            events_count=ev.events_count,
            cases_count=ev.cases_count,
            objects_count=ev.objects_count,
            date_min=ev.date_min,
            date_max=ev.date_max,
            created_at=ev.created_at,
            imported_at=ev.imported_at,
            folder_id=ev.folder_id,
        )
        for ev, owner in rows
    ]
    return AdminLogList(total=total, items=items)


@router.get("/event-logs/{log_id}/download")
async def download_event_log(log_id: str, user: AdminUserDep, session: SessionDep) -> FileResponse:
    """Download the original upload of any user's event log (admin-only).

    Cross-user by design — the same admin gate as the listing above. Returns the
    retained ``original.{ext}`` (the bytes the owner uploaded), not the derived
    Parquet. In S3 mode the log dir is hydrated first so a cold cache still works.
    """
    row = await session.get(EventLog, log_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event log not found")

    paths = log_paths(log_id, row.user_id)
    # The retained upload may live only in S3 on a cold cache — pull the log dir
    # back before locating it (no-op in local mode), mirroring re-import.
    await storage_sync.hydrate_log(row.user_id, log_id)
    located = paths.find_original()
    if located is None or not located.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Original upload is not available for this log.",
        )

    log.info("admin_log_download", admin_id=user.id, log_id=log_id, owner_id=row.user_id)
    return FileResponse(
        located,
        media_type="application/octet-stream",
        filename=row.source_filename or located.name,
    )
