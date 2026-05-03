"""/api/v1/jobs/* — full surface (§7.9.5).

GET  /jobs                       — paginated/filtered list (drives the drawer)
GET  /jobs/{id}                  — detail / poll
POST /jobs/{id}/cancel           — cooperative cancel
POST /jobs/{id}/retry            — re-enqueue a failed job; returns new id
POST /jobs/queue/pause           — stop pulling new jobs
POST /jobs/queue/resume          — resume
WS   /events                     — topic-filtered stream (`?topic=job.*`)
WS   /jobs/{id}/stream           — high-frequency progress for a single job
"""

from __future__ import annotations

import contextlib
import json
import logging
from datetime import datetime
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select

from flows_funds.api.db.models import Job
from flows_funds.api.db.session import SessionDep
from flows_funds.api.events import get_event_bus
from flows_funds.api.jobs.runtime import get_job_runtime
from flows_funds.api.schemas.jobs import JobDetail

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", response_model=list[JobDetail])
async def list_jobs(
    session: SessionDep,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    type_filter: Annotated[str | None, Query(alias="type")] = None,
    since: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[JobDetail]:
    stmt = select(Job).order_by(Job.created_at.desc()).limit(limit)
    if status_filter:
        stmt = stmt.where(Job.status == status_filter)
    if type_filter:
        stmt = stmt.where(Job.type == type_filter)
    if since:
        stmt = stmt.where(Job.created_at >= since)
    rows = (await session.execute(stmt)).scalars().all()
    return [JobDetail.model_validate(r) for r in rows]


@router.get("/{job_id}", response_model=JobDetail)
async def get_job(job_id: str, session: SessionDep) -> JobDetail:
    row = await session.get(Job, job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JobDetail.model_validate(row)


@router.post("/{job_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_job(job_id: str) -> None:
    runtime = get_job_runtime()
    ok = await runtime.cancel(job_id)
    if not ok:
        raise HTTPException(
            status_code=409,
            detail="Job cannot be cancelled — already finished or unknown.",
        )


@router.post("/{job_id}/retry")
async def retry_job(job_id: str) -> dict[str, str]:
    runtime = get_job_runtime()
    new_id = await runtime.retry(job_id)
    if new_id is None:
        raise HTTPException(
            status_code=409,
            detail="Only failed jobs can be retried.",
        )
    return {"job_id": new_id}


@router.post("/queue/pause", status_code=status.HTTP_204_NO_CONTENT)
async def pause_queue() -> None:
    await get_job_runtime().pause_queue()


@router.post("/queue/resume", status_code=status.HTTP_204_NO_CONTENT)
async def resume_queue() -> None:
    await get_job_runtime().resume_queue()


# -- WebSockets --------------------------------------------------------------


async def _ws_send(ws: WebSocket, payload: dict[str, Any]) -> None:
    try:
        await ws.send_text(json.dumps(payload, default=_json_default))
    except RuntimeError:
        # Socket closed underneath us — let the surrounding loop bail out.
        raise WebSocketDisconnect() from None


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


@router.websocket("/{job_id}/stream")
async def stream_job(ws: WebSocket, job_id: str) -> None:
    """High-frequency per-job progress (toast inline bar + drawer focused row).

    Subscribes to `job.progress` / `job.started` / `job.completed` / etc. and
    filters by id. Spec §7.9.5: SQLite-poll fallback applies if the bus is
    momentarily empty — we send an initial snapshot of the row so reconnects
    catch up without missing the early lifecycle events.
    """
    await ws.accept()
    bus = get_event_bus()

    # Initial snapshot — lets a late subscriber paint immediately.
    from flows_funds.api.db.engine import get_sessionmaker

    async with get_sessionmaker()() as session:
        row = await session.get(Job, job_id)
        if row is None:
            await ws.close(code=4404, reason="job not found")
            return
        await _ws_send(ws, {"topic": "job.snapshot", "payload": JobDetail.model_validate(row).model_dump(mode="json")})

    try:
        async with bus.subscribe(["job.*"]) as stream:
            async for env in stream:
                payload = env.payload
                if payload.get("id") != job_id:
                    continue
                await _ws_send(ws, env.to_json())
                if env.topic in {"job.completed", "job.failed", "job.cancelled"}:
                    # Final event — close cleanly.
                    return
    except WebSocketDisconnect:
        return
    except Exception:  # noqa: BLE001
        logging.exception("ws_jobs_stream.unhandled")
        with contextlib.suppress(Exception):
            await ws.close(code=1011)
