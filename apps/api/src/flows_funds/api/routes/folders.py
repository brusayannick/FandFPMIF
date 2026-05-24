"""CRUD + reorder endpoints for /api/v1/folders.

Folders are hierarchical (arbitrary nesting) and live alongside event logs
on the /processes overview. Reorder bulk-updates positions and parents for
both folders and event logs in one shot — DnD on the client commits
exactly once when the drag ends.
"""

from __future__ import annotations

import structlog
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from flows_funds.api.db.models import EventLog, Folder
from flows_funds.api.db.session import SessionDep
from flows_funds.api.schemas.event_logs import (
    FolderCreate,
    FolderSummary,
    FolderUpdate,
    ReorderRequest,
)
from flows_funds.api.uuid7 import uuid7_str

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/folders", tags=["folders"])


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


async def _ensure_no_cycle(
    session, folder_id: str, candidate_parent_id: str | None
) -> None:
    """Walking up from the candidate parent must not land on the folder itself."""
    cur = candidate_parent_id
    while cur is not None:
        if cur == folder_id:
            raise HTTPException(
                status_code=422,
                detail="Cannot move a folder into one of its descendants.",
            )
        parent = await session.get(Folder, cur)
        if parent is None or parent.deleted_at is not None:
            return
        cur = parent.parent_id


@router.get("", response_model=list[FolderSummary])
async def list_folders(session: SessionDep) -> list[FolderSummary]:
    stmt = (
        select(Folder)
        .where(Folder.deleted_at.is_(None))
        .order_by(Folder.position.asc(), Folder.created_at.asc())
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [FolderSummary.model_validate(r) for r in rows]


@router.post("", response_model=FolderSummary, status_code=status.HTTP_201_CREATED)
async def create_folder(payload: FolderCreate, session: SessionDep) -> FolderSummary:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty.")

    if payload.parent_id is not None:
        parent = await session.get(Folder, payload.parent_id)
        if parent is None or parent.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Parent folder not found.")

    # Append: position = max(sibling positions) + 1.
    sib_max_stmt = select(Folder.position).where(
        Folder.deleted_at.is_(None),
        Folder.parent_id.is_(payload.parent_id)
        if payload.parent_id is None
        else Folder.parent_id == payload.parent_id,
    )
    sibling_positions = list((await session.execute(sib_max_stmt)).scalars().all())
    next_pos = (max(sibling_positions) + 1) if sibling_positions else 0

    folder = Folder(
        id=uuid7_str(),
        name=name,
        parent_id=payload.parent_id,
        position=next_pos,
        created_at=_utcnow(),
    )
    session.add(folder)
    await session.commit()
    log.info("folder.created", folder_id=folder.id, parent_id=folder.parent_id)
    return FolderSummary.model_validate(folder)


@router.patch("/{folder_id}", response_model=FolderSummary)
async def update_folder(
    folder_id: str, payload: FolderUpdate, session: SessionDep
) -> FolderSummary:
    folder = await session.get(Folder, folder_id)
    if folder is None or folder.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Folder not found.")

    if payload.name is not None:
        cleaned = payload.name.strip()
        if not cleaned:
            raise HTTPException(status_code=422, detail="Name cannot be empty.")
        if len(cleaned) > 255:
            raise HTTPException(status_code=422, detail="Name is too long (max 255).")
        folder.name = cleaned

    if "parent_id" in payload.model_fields_set:
        if payload.parent_id is not None:
            parent = await session.get(Folder, payload.parent_id)
            if parent is None or parent.deleted_at is not None:
                raise HTTPException(status_code=404, detail="Parent folder not found.")
        await _ensure_no_cycle(session, folder_id, payload.parent_id)
        folder.parent_id = payload.parent_id

    if payload.position is not None:
        folder.position = payload.position

    await session.commit()
    return FolderSummary.model_validate(folder)


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(folder_id: str, session: SessionDep) -> None:
    """Soft-delete a folder. Children (folders and logs) are moved to root."""
    folder = await session.get(Folder, folder_id)
    if folder is None or folder.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Folder not found.")

    # Promote direct children to the folder's parent so deleting "Q1/2025"
    # surfaces its contents under "Q1" rather than orphaning them at root.
    target_parent = folder.parent_id

    child_folders = (
        (
            await session.execute(
                select(Folder).where(
                    Folder.parent_id == folder_id,
                    Folder.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for child in child_folders:
        child.parent_id = target_parent

    child_logs = (
        (
            await session.execute(
                select(EventLog).where(
                    EventLog.folder_id == folder_id,
                    EventLog.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for child in child_logs:
        child.folder_id = target_parent

    folder.deleted_at = _utcnow()
    await session.commit()
    log.info("folder.deleted", folder_id=folder_id)


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder(payload: ReorderRequest, session: SessionDep) -> None:
    """Bulk-update parent + position for any mix of folders and logs.

    The frontend calls this exactly once at the end of a drag with the full
    new ordering — that keeps the DB consistent even if the client has been
    showing optimistic state.
    """
    for item in payload.items:
        if item.kind == "folder":
            row = await session.get(Folder, item.id)
            if row is None or row.deleted_at is not None:
                continue
            if item.parent_id is not None:
                await _ensure_no_cycle(session, item.id, item.parent_id)
            row.parent_id = item.parent_id
            row.position = item.position
        else:  # log
            row = await session.get(EventLog, item.id)
            if row is None or row.deleted_at is not None:
                continue
            row.folder_id = item.parent_id
            row.position = item.position
    await session.commit()
