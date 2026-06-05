"""/api/v1/admin — cross-user operations gated by the Keycloak ``admin`` role.

Two capabilities, both deliberately admin-only (they read every user's data —
emails, usernames, behaviour-tracking events, process metadata):

* download a consistent snapshot of the whole metadata SQLite database;
* download all analytics events as an XES event log for process mining.

See ``apps/web/app/(platform)/admin/export`` for the UI.
"""

from __future__ import annotations

import contextlib
import json
import os
import sqlite3
import tempfile
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from xml.sax.saxutils import escape

import structlog
from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import case as sa_case
from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from starlette.background import BackgroundTask

from mate.api.auth import ADMIN_ROLE, AdminUserDep, CurrentUserDep
from mate.api.config import get_settings
from mate.api.db.engine import get_sessionmaker
from mate.api.db.models import AnalyticsEvent, User
from mate.api.db.session import SessionDep

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])


def _db_path() -> Path:
    """Resolve the on-disk SQLite file backing ``database_url``.

    ``make_url`` turns ``sqlite+aiosqlite:////app/data/metadata.db`` into the
    absolute ``/app/data/metadata.db`` and the dev ``...:///data/metadata.db``
    into the CWD-relative ``data/metadata.db``.
    """
    url = make_url(get_settings().database_url)
    database = url.database
    if not database:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Database is not file-backed; export is only supported for SQLite.",
        )
    return Path(database)


def _snapshot_db(src_path: Path) -> Path:
    """Copy ``src_path`` to a fresh temp file via SQLite's online backup API.

    Safe to call while the app is writing: the backup yields a transactionally
    consistent snapshot of committed data (WAL-aware), unlike a naive file copy.
    The caller owns the returned temp file and must delete it.
    """
    fd, tmp_name = tempfile.mkstemp(prefix="metadata-export-", suffix=".db")
    os.close(fd)
    dst_path = Path(tmp_name)
    dst_path.chmod(0o600)
    src = sqlite3.connect(str(src_path))
    try:
        dst = sqlite3.connect(str(dst_path))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    return dst_path


def _unlink(path: Path) -> None:
    with contextlib.suppress(FileNotFoundError):
        path.unlink()


class ExportInfo(BaseModel):
    is_admin: bool
    # Populated only for admins — a non-admin learns nothing about the data.
    user_count: int | None = None
    event_count: int | None = None
    db_size_bytes: int | None = None


@router.get("/export-info", response_model=ExportInfo)
async def export_info(user: CurrentUserDep, session: SessionDep) -> ExportInfo:
    """Whether the caller may export, plus a size/scope preview for admins.

    Guarded by ``CurrentUserDep`` (not admin) so the export page can render a
    "you need the admin role" state instead of a hard 403 for normal users.
    """
    if ADMIN_ROLE not in user.roles:
        return ExportInfo(is_admin=False)

    user_count = await session.scalar(select(func.count()).select_from(User)) or 0
    event_count = (
        await session.scalar(select(func.count()).select_from(AnalyticsEvent)) or 0
    )
    src = _db_path()
    size = src.stat().st_size if src.exists() else None
    return ExportInfo(
        is_admin=True,
        user_count=int(user_count),
        event_count=int(event_count),
        db_size_bytes=size,
    )


@router.get("/export/metadata-db")
async def export_metadata_db(user: AdminUserDep) -> FileResponse:
    """Stream a consistent snapshot of the full metadata database.

    Admin-only. The snapshot is written to a private temp file and deleted once
    the response finishes streaming.
    """
    src = _db_path()
    if not src.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Database file not found"
        )

    snapshot = await run_in_threadpool(_snapshot_db, src)
    log.info("admin_db_export", admin_id=user.id, bytes=snapshot.stat().st_size)
    ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return FileResponse(
        snapshot,
        media_type="application/x-sqlite3",
        filename=f"metadata-{ts}.db",
        background=BackgroundTask(_unlink, snapshot),
    )


# --------------------------------------------------------------------------
# XES event-log export
# --------------------------------------------------------------------------

_XES_HEADER = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<log xes.version="1.0" xes.features="nested-attributes" '
    'xmlns="http://www.xes-standard.org/">\n'
    '  <extension name="Concept" prefix="concept" '
    'uri="http://www.xes-standard.org/concept.xesext"/>\n'
    '  <extension name="Time" prefix="time" '
    'uri="http://www.xes-standard.org/time.xesext"/>\n'
    '  <extension name="Lifecycle" prefix="lifecycle" '
    'uri="http://www.xes-standard.org/lifecycle.xesext"/>\n'
    '  <classifier name="Activity" keys="concept:name"/>\n'
)


def _xes_q(value: object) -> str:
    """Quote a string for use as an XES XML attribute value."""
    return '"' + escape(str(value), {'"': "&quot;"}) + '"'


def _xes_attr(key: str, value: Any) -> str:
    """Render one typed XES attribute, or "" for ``None`` (omitted)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return f"<boolean key={_xes_q(key)} value=\"{'true' if value else 'false'}\"/>"
    if isinstance(value, int):
        return f'<int key={_xes_q(key)} value="{value}"/>'
    if isinstance(value, float):
        return f'<float key={_xes_q(key)} value="{value}"/>'
    if isinstance(value, (dict, list)):
        value = json.dumps(value, default=str)
    return f"<string key={_xes_q(key)} value={_xes_q(value)}/>"


def _xes_date(key: str, dt: datetime | None) -> str:
    if dt is None:
        return ""
    # Stored naive in UTC — stamp the zone so XES parsers read it correctly.
    return f"<date key={_xes_q(key)} value={_xes_q(dt.replace(tzinfo=UTC).isoformat())}/>"


# Top-level event columns surfaced as XES attributes (besides the standard
# concept:name / time:timestamp / lifecycle:transition). The variable
# per-event ``properties`` dict is flattened alongside under a ``prop:`` prefix.
_EVENT_COLS = (
    "source",
    "event_type",
    "user_id",
    "anon_user_id",
    "session_id",
    "path",
    "referrer",
    "duration_ms",
    "viewport_w",
    "viewport_h",
    "ua_class",
    "locale",
    "tz",
)


def _event_xml(ev: AnalyticsEvent) -> str:
    parts = [
        "    <event>\n",
        f"      {_xes_attr('concept:name', ev.event_name)}\n",
        f"      {_xes_date('time:timestamp', ev.occurred_at)}\n",
        f"      {_xes_attr('lifecycle:transition', 'complete')}\n",
    ]
    for col in _EVENT_COLS:
        attr = _xes_attr(col, getattr(ev, col))
        if attr:
            parts.append(f"      {attr}\n")
    received = _xes_date("server_received_at", ev.server_received_at)
    if received:
        parts.append(f"      {received}\n")
    if isinstance(ev.properties, dict):
        for key, value in ev.properties.items():
            attr = _xes_attr(f"prop:{key}", value)
            if attr:
                parts.append(f"      {attr}\n")
    parts.append("    </event>\n")
    return "".join(parts)


@router.get("/export/event-log.xes")
async def export_event_log_xes(
    user: AdminUserDep,
    case: Literal["session", "user"] = "session",
) -> StreamingResponse:
    """Stream every analytics event (all users) as an XES event log.

    The trace (case) is the browser session by default, or the user with
    ``?case=user``; server-side events (no browser session) fall back to the
    user as their case. Activity is the event name, the timestamp is when it
    occurred, and every column plus the per-event ``properties`` is emitted as
    an XES attribute. The stream is ordered by case then time so traces are
    contiguous, and a fresh DB session is held open for the whole download.
    """
    if case == "user":
        case_key = AnalyticsEvent.user_id
    else:
        case_key = sa_case(
            (AnalyticsEvent.source == "server", AnalyticsEvent.user_id),
            else_=AnalyticsEvent.session_id,
        )
    stmt = select(AnalyticsEvent, case_key.label("case_key")).order_by(
        case_key, AnalyticsEvent.occurred_at, AnalyticsEvent.id
    )

    async def _stream() -> AsyncIterator[str]:
        yield _XES_HEADER
        sm = get_sessionmaker()
        current: str | None = None
        open_trace = False
        async with sm() as session:
            result = await session.stream(stmt)
            async for ev, case_id in result:
                if case_id != current:
                    if open_trace:
                        yield "  </trace>\n"
                    current = case_id
                    open_trace = True
                    yield f"  <trace>\n    {_xes_attr('concept:name', case_id)}\n"
                yield _event_xml(ev)
            if open_trace:
                yield "  </trace>\n"
        yield "</log>\n"

    log.info("admin_xes_export", admin_id=user.id, case=case)
    ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return StreamingResponse(
        _stream(),
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="events-{ts}.xes"'},
    )
