"""POST/GET/DELETE /api/v1/event-logs — the import surface (§6, §13)."""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from typing import Annotated

import aiofiles
import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select

from flows_funds.api.db.models import EventLog
from flows_funds.api.db.session import SessionDep
from flows_funds.api.ingest.dispatch import IMPORT_JOB_TYPE, detect_format
from flows_funds.api.ingest.storage import log_paths
from flows_funds.api.jobs.runtime import JobRuntime, get_job_runtime
from flows_funds.api.schemas.event_logs import (
    CsvColumnMapping,
    EventLogCreateResponse,
    EventLogDetail,
    EventLogSummary,
    EventLogUpdate,
)
from flows_funds.api.uuid7 import uuid7_str

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/event-logs", tags=["event-logs"])


def _runtime_dep() -> JobRuntime:
    return get_job_runtime()


_RuntimeDep = Annotated[JobRuntime, Depends(_runtime_dep)]


@router.post(
    "",
    response_model=EventLogCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_event_log(
    session: SessionDep,
    runtime: _RuntimeDep,
    file: Annotated[UploadFile, File(description="XES, XES.GZ, or CSV upload")],
    name: Annotated[str | None, Form()] = None,
    csv_mapping: Annotated[str | None, Form(description="JSON-encoded CsvColumnMapping")] = None,
) -> EventLogCreateResponse:
    if file.filename is None:
        raise HTTPException(status_code=400, detail="Upload is missing a filename.")

    try:
        source_format = detect_format(file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc

    parsed_mapping: CsvColumnMapping | None = None
    if csv_mapping:
        try:
            parsed_mapping = CsvColumnMapping.model_validate(json.loads(csv_mapping))
        except (ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=422, detail=f"Invalid csv_mapping: {exc}") from exc

    log_id = uuid7_str()
    paths = log_paths(log_id)
    paths.ensure()

    ext = source_format if source_format != "xes.gz" else "xes.gz"
    original_path = paths.original_for(ext)

    async with aiofiles.open(original_path, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            await out.write(chunk)

    display_name = (name or file.filename).strip() or file.filename

    session.add(
        EventLog(
            id=log_id,
            name=display_name,
            source_format=source_format,
            source_filename=file.filename,
            status="importing",
            created_at=datetime.now(UTC).replace(tzinfo=None),
        )
    )
    await session.commit()

    job_id = await runtime.submit(
        type_=IMPORT_JOB_TYPE,
        title=f"Import — {display_name}",
        subtitle=f"event_log.import · {source_format}",
        payload={
            "log_id": log_id,
            "source_format": source_format,
            "original_path": str(original_path),
            "csv_mapping": parsed_mapping.model_dump() if parsed_mapping else None,
        },
    )

    log.info(
        "event_log.created",
        log_id=log_id,
        job_id=job_id,
        source_format=source_format,
    )
    return EventLogCreateResponse(log_id=log_id, job_id=job_id)


@router.get("", response_model=list[EventLogSummary])
async def list_event_logs(
    session: SessionDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query()] = None,
) -> list[EventLogSummary]:
    stmt = select(EventLog).where(EventLog.deleted_at.is_(None)).order_by(EventLog.created_at.desc())
    if status_filter:
        stmt = stmt.where(EventLog.status == status_filter)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(EventLog.name.ilike(like))
    rows = (await session.execute(stmt)).scalars().all()
    return [EventLogSummary.model_validate(r) for r in rows]


@router.get("/{log_id}", response_model=EventLogDetail)
async def get_event_log(log_id: str, session: SessionDep) -> EventLogDetail:
    row = await session.get(EventLog, log_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Event log not found.")
    return EventLogDetail.model_validate(row)


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event_log(log_id: str, session: SessionDep) -> None:
    row = await session.get(EventLog, log_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Event log not found.")
    row.deleted_at = datetime.now(UTC).replace(tzinfo=None)
    await session.commit()
    paths = log_paths(log_id)
    if paths.exists():
        try:
            shutil.rmtree(paths.root)
        except OSError as exc:
            log.warning("event_log.cleanup_failed", log_id=log_id, error=str(exc))


@router.patch("/{log_id}", response_model=EventLogDetail)
async def update_event_log(
    log_id: str,
    payload: EventLogUpdate,
    session: SessionDep,
) -> EventLogDetail:
    row = await session.get(EventLog, log_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Event log not found.")
    if payload.name is not None:
        cleaned = payload.name.strip()
        if not cleaned:
            raise HTTPException(status_code=422, detail="Name cannot be empty.")
        if len(cleaned) > 255:
            raise HTTPException(status_code=422, detail="Name is too long (max 255 characters).")
        row.name = cleaned
    if payload.description is not None:
        # Empty string clears the description; any non-empty value is stored verbatim.
        cleaned_desc = payload.description.strip()
        row.description = cleaned_desc or None
    if payload.column_overrides is not None:
        # Pydantic already enforces dict shape; the schema is open-ended (labels/order/hidden).
        row.column_overrides = payload.column_overrides
    await session.commit()
    return EventLogDetail.model_validate(row)


@router.post(
    "/{log_id}/reimport",
    response_model=EventLogCreateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def reimport_event_log(
    log_id: str,
    session: SessionDep,
    runtime: _RuntimeDep,
) -> EventLogCreateResponse:
    """Re-run the import job using the original upload that's still on disk.

    The CSV mapping (when applicable) is recovered from the previous run's
    `meta.json` so column-mapped CSVs don't need to be re-mapped.
    """
    row = await session.get(EventLog, log_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Event log not found.")
    if row.status == "importing":
        raise HTTPException(status_code=409, detail="Import already in progress.")
    if not row.source_format:
        raise HTTPException(
            status_code=409, detail="No source format on record — cannot re-run import."
        )

    paths = log_paths(log_id)
    original_path = paths.original_for(row.source_format)
    if not original_path.exists():
        raise HTTPException(
            status_code=409,
            detail="Original upload is missing on disk — cannot re-run import.",
        )

    csv_mapping_data: dict | None = None
    if paths.meta.exists():
        try:
            meta = json.loads(paths.meta.read_text())
            mapping = meta.get("mapping") if isinstance(meta, dict) else None
            csv_mapping_data = mapping if isinstance(mapping, dict) else None
        except (OSError, json.JSONDecodeError):
            csv_mapping_data = None

    # Reset derived state so the listing reflects "importing" while the worker
    # rebuilds events.parquet / cases.parquet / meta.json.
    row.status = "importing"
    row.error = None
    row.events_count = None
    row.cases_count = None
    row.variants_count = None
    row.date_min = None
    row.date_max = None
    row.detected_schema = None
    row.imported_at = None
    await session.commit()

    job_id = await runtime.submit(
        type_=IMPORT_JOB_TYPE,
        title=f"Re-import — {row.name}",
        subtitle=f"event_log.import · {row.source_format}",
        payload={
            "log_id": log_id,
            "source_format": row.source_format,
            "original_path": str(original_path),
            "csv_mapping": csv_mapping_data,
        },
    )
    log.info("event_log.reimport_started", log_id=log_id, job_id=job_id)
    return EventLogCreateResponse(log_id=log_id, job_id=job_id)
