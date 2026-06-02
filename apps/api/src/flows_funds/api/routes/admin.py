"""/api/v1/admin — cross-user operations gated by the Keycloak ``admin`` role.

Currently a single capability: download a consistent snapshot of the whole
metadata SQLite database (every user's rows). This is deliberately admin-only —
the file contains all users' emails, usernames, behaviour-tracking events, and
process metadata. See ``apps/web/app/(platform)/admin/export`` for the UI.
"""

from __future__ import annotations

import contextlib
import os
import sqlite3
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import structlog
from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.engine import make_url
from starlette.background import BackgroundTask

from flows_funds.api.auth import ADMIN_ROLE, AdminUserDep, CurrentUserDep
from flows_funds.api.config import get_settings
from flows_funds.api.db.models import User
from flows_funds.api.db.session import SessionDep

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
    src = _db_path()
    size = src.stat().st_size if src.exists() else None
    return ExportInfo(is_admin=True, user_count=int(user_count), db_size_bytes=size)


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
