"""In-process asyncio job runtime.

What's wired (phase 4):

  - SQLite-persisted Job rows; UUID v7 ids.
  - Configurable worker pool (asyncio tasks) with cooperative cancellation
    via a per-job `asyncio.Event`.
  - Lifecycle events emitted on the platform `EventBus`: `job.queued`,
    `job.started`, `job.progress`, `job.completed`, `job.failed`,
    `job.cancelled`, `job.queue.paused`, `job.queue.resumed`.
  - Whole-queue pause/resume: workers stop pulling new jobs but keep
    running ones going (the spec calls this out in §7.9.5).
  - Progress is throttled to SQLite (every `progress_persist_every` ticks),
    but every call broadcasts on the bus — this keeps the drawer's per-job
    `WS /jobs/{id}/stream` smooth without writing to disk thousands of times
    per import.
  - Retry: re-enqueue with the same payload but a fresh job id.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker

from flows_funds.api.config import Settings, get_settings
from flows_funds.api.db.engine import get_sessionmaker
from flows_funds.api.db.models import Job
from flows_funds.api.events import EventBus, get_event_bus
from flows_funds.api.uuid7 import uuid7_str

log = structlog.get_logger(__name__)


def _utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class JobCancelled(Exception):
    """Raised inside a handler when the job is cancelled cooperatively."""


JobHandler = Callable[["JobHandle"], Awaitable[None]]


@dataclass
class CancelToken:
    _flag: asyncio.Event = field(default_factory=asyncio.Event)

    def cancel(self) -> None:
        self._flag.set()

    @property
    def cancelled(self) -> bool:
        return self._flag.is_set()

    def raise_if_cancelled(self) -> None:
        if self._flag.is_set():
            raise JobCancelled()


@dataclass
class JobHandle:
    """Handed to a job handler. Provides progress reporting, payload access,
    a sessionmaker, the cancel token, and the bus.
    """

    id: str
    type: str
    title: str
    subtitle: str | None
    module_id: str | None
    payload: dict[str, Any]
    sessionmaker: async_sessionmaker
    settings: Settings
    bus: EventBus
    cancel_token: CancelToken
    started_at: float
    _last_persist_count: int = 0

    @property
    def cancelled(self) -> bool:
        return self.cancel_token.cancelled

    def raise_if_cancelled(self) -> None:
        self.cancel_token.raise_if_cancelled()

    async def progress(
        self,
        current: int,
        total: int | None = None,
        *,
        stage: str | None = None,
        message: str | None = None,
        force: bool = False,
    ) -> None:
        elapsed = max(time.monotonic() - self.started_at, 1e-6)
        rate = current / elapsed if current else None
        eta = ((total - current) / rate) if (rate and total and total > current) else None

        await self.bus.publish(
            "job.progress",
            {
                "id": self.id,
                "type": self.type,
                "module_id": self.module_id,
                "current": current,
                "total": total,
                "stage": stage,
                "message": message,
                "rate": rate,
                "eta_seconds": eta,
            },
        )

        every = self.settings.progress_persist_every
        if not force and (current - self._last_persist_count) < every:
            return
        self._last_persist_count = current
        async with self.sessionmaker() as session:
            await session.execute(
                update(Job)
                .where(Job.id == self.id)
                .values(
                    progress_current=current,
                    progress_total=total,
                    stage=stage,
                    message=message,
                    rate=rate,
                    eta_seconds=eta,
                )
            )
            await session.commit()


class JobRuntime:
    """Asyncio queue + worker pool. Handlers register by `type`."""

    def __init__(self, settings: Settings | None = None, bus: EventBus | None = None) -> None:
        self.settings = settings or get_settings()
        self._bus = bus
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._handlers: dict[str, JobHandler] = {}
        self._workers: list[asyncio.Task[None]] = []
        self._running = False
        self._paused = asyncio.Event()
        self._paused.set()  # set = NOT paused (we wait while it's clear)
        self._cancel_tokens: dict[str, CancelToken] = {}

    def _ensure_bus(self) -> EventBus:
        return self._bus if self._bus is not None else get_event_bus()

    def register(self, type_: str, handler: JobHandler) -> None:
        if type_ in self._handlers:
            raise RuntimeError(f"Job type already registered: {type_}")
        self._handlers[type_] = handler

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        for _ in range(self.settings.worker_concurrency):
            self._workers.append(asyncio.create_task(self._worker_loop()))
        log.info("job_runtime.started", workers=self.settings.worker_concurrency)

    async def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        for w in self._workers:
            w.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()
        for tok in self._cancel_tokens.values():
            tok.cancel()
        self._cancel_tokens.clear()
        log.info("job_runtime.stopped")

    @contextlib.asynccontextmanager
    async def lifespan(self):
        await self.start()
        try:
            yield self
        finally:
            await self.stop()

    @property
    def is_paused(self) -> bool:
        return not self._paused.is_set()

    async def pause_queue(self) -> None:
        if self.is_paused:
            return
        self._paused.clear()
        await self._ensure_bus().publish("job.queue.paused", {})
        log.info("job_runtime.queue_paused")

    async def resume_queue(self) -> None:
        if not self.is_paused:
            return
        self._paused.set()
        await self._ensure_bus().publish("job.queue.resumed", {})
        log.info("job_runtime.queue_resumed")

    async def submit(
        self,
        *,
        type_: str,
        title: str,
        payload: dict[str, Any],
        subtitle: str | None = None,
        module_id: str | None = None,
        priority: int = 0,
        parent_job_id: str | None = None,
        job_id: str | None = None,
    ) -> str:
        if type_ not in self._handlers:
            raise RuntimeError(f"No handler registered for job type: {type_}")
        job_id = job_id or uuid7_str()
        sm = get_sessionmaker()
        async with sm() as session:
            session.add(
                Job(
                    id=job_id,
                    type=type_,
                    title=title,
                    subtitle=subtitle,
                    module_id=module_id,
                    payload_json=payload,
                    status="queued",
                    priority=priority,
                    parent_job_id=parent_job_id,
                )
            )
            await session.commit()

        await self._ensure_bus().publish(
            "job.queued",
            {
                "id": job_id,
                "type": type_,
                "title": title,
                "subtitle": subtitle,
                "module_id": module_id,
                "priority": priority,
            },
        )
        await self._queue.put(job_id)
        return job_id

    async def cancel(self, job_id: str) -> bool:
        """Mark a job cancelled. Returns True if it was queued or running.

        - If running: the cooperative `CancelToken` is set; the handler is
          expected to call `handle.raise_if_cancelled()` periodically. The
          worker catches `JobCancelled` and updates the row + emits the event.
        - If queued: we mark the row cancelled and emit the event right away;
          when the worker pulls the id off the queue it'll see the status and
          skip the work.
        """
        sm = get_sessionmaker()
        async with sm() as session:
            job = await session.get(Job, job_id)
            if job is None:
                return False
            if job.status not in {"queued", "running"}:
                return False
            running = job.status == "running"
            if not running:
                job.status = "cancelled"
                job.finished_at = _utcnow_naive()
                await session.commit()

        token = self._cancel_tokens.get(job_id)
        if token is not None:
            token.cancel()

        if not running:
            await self._ensure_bus().publish("job.cancelled", {"id": job_id, "reason": "queued"})
        return True

    async def retry(self, job_id: str) -> str | None:
        """Re-enqueue a failed job with the same payload. Returns the new job id."""
        sm = get_sessionmaker()
        async with sm() as session:
            job = await session.get(Job, job_id)
            if job is None or job.status != "failed":
                return None
            new_id = await self.submit(
                type_=job.type,
                title=job.title,
                subtitle=job.subtitle,
                module_id=job.module_id,
                payload=dict(job.payload_json),
                priority=job.priority,
                parent_job_id=job.parent_job_id,
            )
        return new_id

    async def _worker_loop(self) -> None:
        sm = get_sessionmaker()
        while self._running:
            # Honour pause before pulling work.
            try:
                await self._paused.wait()
            except asyncio.CancelledError:
                return
            try:
                job_id = await self._queue.get()
            except asyncio.CancelledError:
                return

            try:
                await self._run_one(job_id, sm)
            except Exception as exc:  # noqa: BLE001
                log.exception("job_runtime.unexpected_error", job_id=job_id, error=str(exc))
            finally:
                self._queue.task_done()

    async def _run_one(self, job_id: str, sm: async_sessionmaker) -> None:
        bus = self._ensure_bus()

        async with sm() as session:
            job = await session.get(Job, job_id)
            if job is None:
                log.warning("job_runtime.missing_job", job_id=job_id)
                return
            if job.status == "cancelled":
                # Cancelled while queued — already handled in `cancel()`.
                return
            handler = self._handlers.get(job.type)
            if handler is None:
                job.status = "failed"
                job.error = f"No handler registered for type {job.type!r}"
                job.finished_at = _utcnow_naive()
                await session.commit()
                await bus.publish(
                    "job.failed",
                    {"id": job.id, "type": job.type, "error": job.error},
                )
                return
            job.status = "running"
            job.started_at = _utcnow_naive()
            await session.commit()

            handle_payload = dict(job.payload_json)
            handle_title = job.title
            handle_subtitle = job.subtitle
            handle_module_id = job.module_id
            handle_type = job.type

        token = CancelToken()
        self._cancel_tokens[job_id] = token

        await bus.publish(
            "job.started",
            {
                "id": job_id,
                "type": handle_type,
                "title": handle_title,
                "module_id": handle_module_id,
            },
        )

        handle = JobHandle(
            id=job_id,
            type=handle_type,
            title=handle_title,
            subtitle=handle_subtitle,
            module_id=handle_module_id,
            payload=handle_payload,
            sessionmaker=sm,
            settings=self.settings,
            bus=bus,
            cancel_token=token,
            started_at=time.monotonic(),
        )

        try:
            await self._handlers[handle_type](handle)
        except JobCancelled:
            async with sm() as session:
                await session.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(status="cancelled", finished_at=_utcnow_naive()),
                )
                await session.commit()
            await bus.publish("job.cancelled", {"id": job_id, "reason": "running"})
            return
        except Exception as exc:  # noqa: BLE001
            logging.exception("Job handler failed for %s", job_id)
            async with sm() as session:
                await session.execute(
                    update(Job)
                    .where(Job.id == job_id)
                    .values(
                        status="failed",
                        error=str(exc),
                        finished_at=_utcnow_naive(),
                    )
                )
                await session.commit()
            await bus.publish(
                "job.failed",
                {"id": job_id, "type": handle_type, "error": str(exc)},
            )
            return
        finally:
            self._cancel_tokens.pop(job_id, None)

        async with sm() as session:
            await session.execute(
                update(Job)
                .where(Job.id == job_id)
                .values(status="completed", finished_at=_utcnow_naive()),
            )
            await session.commit()

        await bus.publish(
            "job.completed",
            {"id": job_id, "type": handle_type, "module_id": handle_module_id},
        )


_runtime: JobRuntime | None = None


def set_job_runtime(rt: JobRuntime | None) -> None:
    global _runtime
    _runtime = rt


def get_job_runtime() -> JobRuntime:
    if _runtime is None:
        raise RuntimeError("Job runtime is not initialised — startup did not run.")
    return _runtime
