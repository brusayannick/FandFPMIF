"""CRUD + node execution for /api/v1/flows (the node-graph builder).

A flow is a node graph (``source -> module -> transform -> viz``) bound to one
event log, stored as one ``graph_json`` blob - parallel to a dashboard. Every
row is keyed by the Keycloak ``sub`` (``user.id``). ``GET
/flows/{id}/nodes/{node_id}/data`` executes a single node (resolving its
upstream) and returns the envelope - it powers both the editor's live previews
and ``kind:"flow"`` dashboard cards.
"""

from __future__ import annotations

from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, Header, HTTPException, status
from sqlalchemy import select

from mate.api.auth import CurrentUserDep, get_owned_event_log
from mate.api.datasets.envelope import DatasetEnvelope
from mate.api.db.models import Flow, FlowShare, Team, User
from mate.api.db.session import SessionDep
from mate.api.flows.engine import FlowExecutionError, resolve_node
from mate.api.modules import get_module_loader
from mate.api.modules.loader import decode_event_filter_header
from mate.api.schemas.flows import (
    FlowCreate,
    FlowDetail,
    FlowGraph,
    FlowSummary,
    FlowUpdate,
)
from mate.api.schemas.sharing import FlowShareOut, ShareCreate
from mate.api.sharing import (
    can_share_with_team,
    can_share_with_user,
    get_accessible_flow,
    user_label,
)
from mate.api.uuid7 import uuid7_str

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/flows", tags=["flows"])


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _graph_of(row: Flow) -> FlowGraph:
    try:
        return FlowGraph.model_validate(row.graph_json or {})
    except Exception:
        log.warning("flow.graph_invalid", flow_id=row.id)
        return FlowGraph()


def _detail(row: Flow, *, is_owner: bool = True) -> FlowDetail:
    return FlowDetail(
        id=row.id,
        name=row.name,
        description=row.description,
        event_log_id=row.event_log_id,
        log_model=row.log_model,  # type: ignore[arg-type]
        graph=_graph_of(row),
        created_at=row.created_at,
        updated_at=row.updated_at,
        is_owner=is_owner,
    )


async def _get_owned(session: SessionDep, flow_id: str, user_id: str) -> Flow:
    row = await session.get(Flow, flow_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="Flow not found.")
    return row


async def _validate_log(
    session: SessionDep, log_id: str | None, user_id: str, log_model: str | None = None
) -> None:
    if log_id is None:
        return
    row = await get_owned_event_log(session, log_id, user_id)
    if log_model is not None and row.log_model != log_model:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Log is {row.log_model}; this flow is {log_model}.",
        )


@router.get("", response_model=list[FlowSummary])
async def list_flows(session: SessionDep, user: CurrentUserDep) -> list[FlowSummary]:
    stmt = (
        select(Flow)
        .where(Flow.user_id == user.id)
        .order_by(Flow.position.asc(), Flow.created_at.desc())
    )
    rows = (await session.execute(stmt)).scalars().all()
    return [
        FlowSummary(
            id=r.id,
            name=r.name,
            description=r.description,
            event_log_id=r.event_log_id,
            log_model=r.log_model,  # type: ignore[arg-type]
            node_count=len((r.graph_json or {}).get("nodes", [])),
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("", response_model=FlowDetail, status_code=status.HTTP_201_CREATED)
async def create_flow(payload: FlowCreate, session: SessionDep, user: CurrentUserDep) -> FlowDetail:
    await _validate_log(session, payload.event_log_id, user.id, payload.log_model)
    row = Flow(
        id=uuid7_str(),
        user_id=user.id,
        name=payload.name,
        description=payload.description,
        event_log_id=payload.event_log_id,
        log_model=payload.log_model,
        graph_json=payload.graph.model_dump(),
        created_at=_utcnow(),
    )
    session.add(row)
    await session.commit()
    log.info("flow.created", flow_id=row.id)
    return _detail(row)


@router.get("/{flow_id}", response_model=FlowDetail)
async def get_flow(flow_id: str, session: SessionDep, user: CurrentUserDep) -> FlowDetail:
    # Owner or share recipient may view; recipients get a read-only flow.
    row = await get_accessible_flow(session, flow_id, user.id)
    return _detail(row, is_owner=row.user_id == user.id)


@router.patch("/{flow_id}", response_model=FlowDetail)
async def update_flow(
    flow_id: str, payload: FlowUpdate, session: SessionDep, user: CurrentUserDep
) -> FlowDetail:
    row = await _get_owned(session, flow_id, user.id)
    fields = payload.model_fields_set
    if "name" in fields and payload.name is not None:
        row.name = payload.name
    if "description" in fields:
        row.description = payload.description
    if "event_log_id" in fields:
        await _validate_log(session, payload.event_log_id, user.id, row.log_model)
        row.event_log_id = payload.event_log_id
    if "graph" in fields and payload.graph is not None:
        row.graph_json = payload.graph.model_dump()
    await session.commit()
    return _detail(row)


@router.delete("/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flow(flow_id: str, session: SessionDep, user: CurrentUserDep) -> None:
    row = await _get_owned(session, flow_id, user.id)
    await session.delete(row)
    await session.commit()
    log.info("flow.deleted", flow_id=flow_id)


@router.get("/{flow_id}/nodes/{node_id}/data", response_model=DatasetEnvelope)
async def get_node_data(
    flow_id: str,
    node_id: str,
    session: SessionDep,
    user: CurrentUserDep,
    log_id: str | None = None,
    x_ff_event_filter: str | None = Header(default=None, alias="X-FF-Event-Filter"),
) -> DatasetEnvelope:
    """Execute one node (resolving its upstream chain) and return its envelope.
    ``log_id`` defaults to the flow's bound log; honors the ephemeral filter.
    Owner or share recipient (the data reads resolve to the owner's log)."""
    row = await get_accessible_flow(session, flow_id, user.id)
    effective_log = log_id or row.event_log_id
    if not effective_log:
        raise HTTPException(status_code=400, detail="No event log bound to this flow.")
    loader = get_module_loader()
    try:
        return await resolve_node(
            loader,
            row.graph_json or {},
            node_id,
            effective_log,
            user.id,
            filter_override=decode_event_filter_header(x_ff_event_filter),
        )
    except FlowExecutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


async def _flow_share_out(session: SessionDep, share: FlowShare) -> FlowShareOut:
    if share.target_team_id:
        team = await session.get(Team, share.target_team_id)
        return FlowShareOut(
            id=share.id,
            flow_id=share.flow_id,
            kind="team",
            target_id=share.target_team_id,
            label=team.name if team else "Unknown team",
            created_at=share.created_at,
        )
    target = await session.get(User, share.target_user_id) if share.target_user_id else None
    return FlowShareOut(
        id=share.id,
        flow_id=share.flow_id,
        kind="user",
        target_id=share.target_user_id or "",
        label=user_label(target),
        created_at=share.created_at,
    )


@router.get("/{flow_id}/shares", response_model=list[FlowShareOut])
async def list_flow_shares(
    flow_id: str, session: SessionDep, user: CurrentUserDep
) -> list[FlowShareOut]:
    await _get_owned(session, flow_id, user.id)
    rows = (
        (
            await session.execute(
                select(FlowShare)
                .where(FlowShare.flow_id == flow_id)
                .order_by(FlowShare.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return [await _flow_share_out(session, r) for r in rows]


@router.post("/{flow_id}/shares", response_model=FlowShareOut, status_code=status.HTTP_201_CREATED)
async def add_flow_share(
    flow_id: str, payload: ShareCreate, session: SessionDep, user: CurrentUserDep
) -> FlowShareOut:
    await _get_owned(session, flow_id, user.id)
    if payload.target_user_id is not None:
        if payload.target_user_id == user.id:
            raise HTTPException(status_code=400, detail="You already own this flow.")
        if await session.get(User, payload.target_user_id) is None:
            raise HTTPException(status_code=404, detail="User not found.")
        if not await can_share_with_user(session, payload.target_user_id, user.id):
            raise HTTPException(status_code=403, detail="You can only share with members of your teams.")
        dup = (
            select(FlowShare.id)
            .where(FlowShare.flow_id == flow_id, FlowShare.target_user_id == payload.target_user_id)
            .limit(1)
        )
    else:
        if await session.get(Team, payload.target_team_id) is None:
            raise HTTPException(status_code=404, detail="Team not found.")
        if not await can_share_with_team(session, payload.target_team_id or "", user.id):
            raise HTTPException(status_code=403, detail="You can only share with teams you belong to.")
        dup = (
            select(FlowShare.id)
            .where(FlowShare.flow_id == flow_id, FlowShare.target_team_id == payload.target_team_id)
            .limit(1)
        )
    if (await session.execute(dup)).first() is not None:
        raise HTTPException(status_code=409, detail="Already shared with this target.")
    share = FlowShare(
        id=uuid7_str(),
        flow_id=flow_id,
        target_user_id=payload.target_user_id,
        target_team_id=payload.target_team_id,
        created_by=user.id,
        created_at=_utcnow(),
    )
    session.add(share)
    await session.commit()
    log.info("flow.shared", flow_id=flow_id, share_id=share.id)
    return await _flow_share_out(session, share)


@router.delete("/{flow_id}/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_flow_share(
    flow_id: str, share_id: str, session: SessionDep, user: CurrentUserDep
) -> None:
    await _get_owned(session, flow_id, user.id)
    share = await session.get(FlowShare, share_id)
    if share is None or share.flow_id != flow_id:
        raise HTTPException(status_code=404, detail="Share not found.")
    await session.delete(share)
    await session.commit()
    log.info("flow.unshared", flow_id=flow_id, share_id=share_id)
