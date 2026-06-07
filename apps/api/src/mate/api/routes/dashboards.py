"""CRUD + export/import for /api/v1/dashboards.

A dashboard is a saved grid of cards (each a module's `(widget_id)`) bound to a
single event log; every card renders against that log. The board state (placed
cards + react-grid-layout geometry) is stored as one JSON blob, so a save is a
single atomic write and export is a passthrough.

Every row is keyed by the Keycloak `sub` (``user.id``); a dashboard and its
bound log are both validated against the current user on every access.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from mate.api.auth import CurrentUserDep, get_owned_event_log
from mate.api.db.models import Dashboard
from mate.api.db.session import SessionDep
from mate.api.schemas.dashboards import (
    CanvasSettings,
    DashboardCreate,
    DashboardDetail,
    DashboardExport,
    DashboardImport,
    DashboardItem,
    DashboardSummary,
    DashboardUpdate,
)
from mate.api.uuid7 import uuid7_str

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/dashboards", tags=["dashboards"])


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _items_of(row: Dashboard) -> list[DashboardItem]:
    raw = (row.layout_json or {}).get("items", [])
    items: list[DashboardItem] = []
    for entry in raw:
        try:
            items.append(DashboardItem.model_validate(entry))
        except Exception:
            # Skip a malformed/legacy item rather than 500 the whole board.
            log.warning("dashboard.item_skipped", dashboard_id=row.id, entry=entry)
    return items


def _settings_of(row: Dashboard) -> CanvasSettings:
    raw = (row.layout_json or {}).get("settings")
    if not raw:
        return CanvasSettings()
    try:
        return CanvasSettings.model_validate(raw)
    except Exception:
        # Fall back to defaults rather than 500 on a legacy/garbled blob.
        log.warning("dashboard.settings_invalid", dashboard_id=row.id, raw=raw)
        return CanvasSettings()


def _layout_blob(items: list[DashboardItem], settings: CanvasSettings) -> dict[str, Any]:
    return {"items": [it.model_dump() for it in items], "settings": settings.model_dump()}


def _detail(row: Dashboard) -> DashboardDetail:
    return DashboardDetail(
        id=row.id,
        name=row.name,
        description=row.description,
        event_log_id=row.event_log_id,
        log_model=row.log_model,  # type: ignore[arg-type]
        items=_items_of(row),
        settings=_settings_of(row),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _get_owned(session: SessionDep, dashboard_id: str, user_id: str) -> Dashboard:
    row = await session.get(Dashboard, dashboard_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Dashboard not found.")
    return row


async def _validate_log(
    session: SessionDep, log_id: str | None, user_id: str, log_model: str | None = None
) -> None:
    """A bound log must belong to the user and (when ``log_model`` is given)
    match the board's data model. ``None`` (unbound) is always allowed."""
    if log_id is None:
        return
    row = await get_owned_event_log(session, log_id, user_id)
    if log_model is not None and row.log_model != log_model:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Log is {row.log_model}; this dashboard is {log_model}.",
        )


@router.get("", response_model=list[DashboardSummary])
async def list_dashboards(session: SessionDep, user: CurrentUserDep) -> list[DashboardSummary]:
    stmt = (
        select(Dashboard)
        .where(Dashboard.user_id == user.id)
        .order_by(Dashboard.position.asc(), Dashboard.created_at.desc())
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [
        DashboardSummary(
            id=r.id,
            name=r.name,
            description=r.description,
            event_log_id=r.event_log_id,
            log_model=r.log_model,  # type: ignore[arg-type]
            card_count=len((r.layout_json or {}).get("items", [])),
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("", response_model=DashboardDetail, status_code=status.HTTP_201_CREATED)
async def create_dashboard(
    payload: DashboardCreate, session: SessionDep, user: CurrentUserDep
) -> DashboardDetail:
    await _validate_log(session, payload.event_log_id, user.id, payload.log_model)
    row = Dashboard(
        id=uuid7_str(),
        user_id=user.id,
        name=payload.name,
        description=payload.description,
        event_log_id=payload.event_log_id,
        log_model=payload.log_model,
        layout_json=_layout_blob(payload.items, payload.settings),
        created_at=_utcnow(),
    )
    session.add(row)
    await session.commit()
    log.info("dashboard.created", dashboard_id=row.id)
    return _detail(row)


@router.get("/{dashboard_id}", response_model=DashboardDetail)
async def get_dashboard(
    dashboard_id: str, session: SessionDep, user: CurrentUserDep
) -> DashboardDetail:
    row = await _get_owned(session, dashboard_id, user.id)
    return _detail(row)


@router.patch("/{dashboard_id}", response_model=DashboardDetail)
async def update_dashboard(
    dashboard_id: str,
    payload: DashboardUpdate,
    session: SessionDep,
    user: CurrentUserDep,
) -> DashboardDetail:
    row = await _get_owned(session, dashboard_id, user.id)
    fields = payload.model_fields_set

    if "name" in fields and payload.name is not None:
        row.name = payload.name
    if "description" in fields:
        row.description = payload.description
    if "event_log_id" in fields:
        await _validate_log(session, payload.event_log_id, user.id, row.log_model)
        row.event_log_id = payload.event_log_id
    # Items and settings share one blob, so rewrite it whenever either is
    # touched, keeping the untouched sibling as-is.
    if ("items" in fields and payload.items is not None) or (
        "settings" in fields and payload.settings is not None
    ):
        items = payload.items if payload.items is not None else _items_of(row)
        settings = payload.settings if payload.settings is not None else _settings_of(row)
        row.layout_json = _layout_blob(items, settings)

    await session.commit()
    return _detail(row)


@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dashboard(dashboard_id: str, session: SessionDep, user: CurrentUserDep) -> None:
    row = await _get_owned(session, dashboard_id, user.id)
    await session.delete(row)
    await session.commit()
    log.info("dashboard.deleted", dashboard_id=dashboard_id)


@router.get("/{dashboard_id}/export", response_model=DashboardExport)
async def export_dashboard(
    dashboard_id: str, session: SessionDep, user: CurrentUserDep
) -> DashboardExport:
    """Portable, id-free snapshot for download. Re-importable via POST /import.

    Intentionally drops the bound `event_log_id` — logs are per-user and the
    importer rebinds on the target machine.
    """
    row = await _get_owned(session, dashboard_id, user.id)
    return DashboardExport(
        name=row.name,
        description=row.description,
        log_model=row.log_model,  # type: ignore[arg-type]
        items=_items_of(row),
        settings=_settings_of(row),
    )


@router.post("/import", response_model=DashboardDetail, status_code=status.HTTP_201_CREATED)
async def import_dashboard(
    payload: DashboardImport, session: SessionDep, user: CurrentUserDep
) -> DashboardDetail:
    await _validate_log(session, payload.event_log_id, user.id, payload.log_model)
    row = Dashboard(
        id=uuid7_str(),
        user_id=user.id,
        name=(payload.name or "Imported dashboard").strip() or "Imported dashboard",
        description=payload.description,
        event_log_id=payload.event_log_id,
        log_model=payload.log_model,
        layout_json=_layout_blob(payload.items, payload.settings),
        created_at=_utcnow(),
    )
    session.add(row)
    await session.commit()
    log.info("dashboard.imported", dashboard_id=row.id, cards=len(payload.items))
    return _detail(row)
