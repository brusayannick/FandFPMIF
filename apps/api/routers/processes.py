from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select, func

from core.dependencies import SessionDep
from models.process import ProcessDefinition
from modules.registry import registry
from schemas.graph import GraphSchema
from schemas.process import (
    ProcessCreate,
    ProcessDetail,
    ProcessSaveGraph,
    ProcessSaveResponse,
    ProcessSummary,
    ProcessUpdate,
)
from services.graph_service import GraphValidationError, validate_dag


router = APIRouter()


def _graph_from_row(row: ProcessDefinition) -> GraphSchema:
    data = row.graph or {"nodes": [], "edges": []}
    return GraphSchema.model_validate(data)


def _summary(row: ProcessDefinition) -> ProcessSummary:
    return ProcessSummary(
        id=row.id,
        name=row.name,
        description=row.description,
        node_count=row.node_count,
        edge_count=row.edge_count,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _detail(row: ProcessDefinition) -> ProcessDetail:
    base = _summary(row).model_dump()
    return ProcessDetail(**base, graph=_graph_from_row(row))


@router.get("", response_model=list[ProcessSummary])
async def list_processes(session: SessionDep) -> list[ProcessSummary]:
    result = await session.execute(
        select(ProcessDefinition).order_by(ProcessDefinition.updated_at.desc())
    )
    return [_summary(row) for row in result.scalars()]


@router.post(
    "",
    response_model=ProcessSummary,
    status_code=status.HTTP_201_CREATED,
)
async def create_process(
    payload: ProcessCreate, session: SessionDep
) -> ProcessSummary:
    row = ProcessDefinition(
        name=payload.name,
        description=payload.description,
        graph={"nodes": [], "edges": []},
        node_count=0,
        edge_count=0,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _summary(row)


@router.get("/{process_id}", response_model=ProcessDetail)
async def get_process(process_id: str, session: SessionDep) -> ProcessDetail:
    row = await session.get(ProcessDefinition, process_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Process not found")
    return _detail(row)


@router.patch("/{process_id}", response_model=ProcessSummary)
async def update_process(
    process_id: str,
    payload: ProcessUpdate,
    session: SessionDep,
) -> ProcessSummary:
    row = await session.get(ProcessDefinition, process_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Process not found")
    if payload.name is not None:
        row.name = payload.name
    if payload.description is not None:
        row.description = payload.description
    await session.commit()
    await session.refresh(row)
    return _summary(row)


@router.put("/{process_id}/graph", response_model=ProcessSaveResponse)
async def save_graph(
    process_id: str,
    payload: ProcessSaveGraph,
    session: SessionDep,
) -> ProcessSaveResponse:
    row = await session.get(ProcessDefinition, process_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Process not found")

    try:
        result = validate_dag(payload.graph, strict=False)
    except GraphValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    row.graph = payload.graph.model_dump(mode="json", by_alias=True)
    row.node_count = result.node_count
    row.edge_count = result.edge_count
    await session.commit()
    await session.refresh(row)

    registry.notify_graph_update(payload.graph)

    return ProcessSaveResponse(
        id=row.id,
        node_count=row.node_count,
        edge_count=row.edge_count,
        updated_at=row.updated_at,
        validation_warnings=result.warnings,
    )


@router.delete("/{process_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_process(process_id: str, session: SessionDep) -> None:
    row = await session.get(ProcessDefinition, process_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Process not found")
    await session.delete(row)
    await session.commit()


@router.get("/{process_id}/count", response_model=dict)
async def count(session: SessionDep) -> dict:
    total = await session.scalar(select(func.count(ProcessDefinition.id)))
    return {"total": int(total or 0)}
