"""Module-processing coordinator — hold a freshly imported log disabled until
every subscribing module has finished precomputing against it.

The lifecycle a log moves through is:

    importing  → parsing the source file
    processing → parsed; the modules that subscribe to the import topic
                 (``log.imported`` / ``ocel.imported``) are precomputing
    ready      → all expected modules reached a terminal job → openable
    failed     → the import itself errored

"All modules" is the *importing user's* installed modules that subscribe to the
import topic (modules are per-user via ``module_installs``). The expected set is
frozen at import time so the decision is deterministic — querying it lazily would
risk a "0 subscribers seen yet → flip to ready early" race. Completion is derived
from the ``Job`` rows (the per-module precompute jobs, linked to the import job by
``parent_job_id``) rather than an in-memory counter, so it survives an API
restart: the boot reconcile re-derives it from the database.
"""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from mate.api.db.models import EventLog, Job
from mate.api.events import EventBus
from mate.api.modules.installs import user_module_ids
from mate.api.modules.loader import ModuleLoader

log = structlog.get_logger(__name__)

# A module precompute job is "done" — for the purpose of un-gating the log — once
# it reaches any of these. A failed/cancelled module must not strand the log in
# `processing` forever, so it counts as terminal just like a success.
_TERMINAL_JOB_STATUSES = ("completed", "failed", "cancelled")

# The import job type whose children are the per-module precompute jobs. Mirrors
# ``mate.api.ingest.dispatch.IMPORT_JOB_TYPE`` (kept inline to avoid importing the
# ingest layer into the module layer).
_IMPORT_JOB_TYPE = "event_log.import"


class ModuleProcessingCoordinator:
    """Owns the ``processing`` → ``ready`` transition for imported logs."""

    def __init__(
        self,
        loader: ModuleLoader,
        bus: EventBus,
        sessionmaker: async_sessionmaker[AsyncSession],
    ) -> None:
        self._loader = loader
        self._bus = bus
        self._sessionmaker = sessionmaker

    async def expected_modules(self, topic: str, user_id: str, session: AsyncSession) -> set[str]:
        """The modules a log imported on ``topic`` must wait on for ``user_id``.

        Intersection of the loader's event subscribers for ``topic`` with the
        modules the user has actually installed — a module loaded for another
        tenant never holds this user's log.
        """
        subscribers = self._loader.event_subscriber_module_ids(topic)
        if not subscribers:
            return set()
        owned = await user_module_ids(session, user_id)
        return subscribers & owned

    async def check_and_finalize(self, log_id: str, session: AsyncSession) -> bool:
        """Flip a ``processing`` log to ``ready`` once its expected modules are done.

        No-op (returns ``False``) when the log is missing, soft-deleted, or not in
        ``processing``. Otherwise compares the expected module-id set against the
        modules whose child precompute job (under the import job) has reached a
        terminal state; when the terminal set covers the expected set the log is
        marked ``ready``, the two processing columns are cleared, and a
        ``log.ready`` event is published. Returns ``True`` when it flipped.
        """
        row = await session.get(EventLog, log_id)
        if row is None or row.deleted_at is not None:
            return False
        if row.status != "processing":
            return False

        expected = set(row.expected_modules or [])
        import_job_id = row.processing_import_job_id

        # Defensive: a processing row with no expected set / no import job can
        # never be un-gated by jobs — treat it as immediately complete so it
        # can't strand. (The ingest handler never writes this shape.)
        if not expected or not import_job_id:
            terminal_covering = True
        else:
            result = await session.execute(
                select(Job.module_id).where(
                    Job.parent_job_id == import_job_id,
                    Job.module_id.in_(expected),
                    Job.status.in_(_TERMINAL_JOB_STATUSES),
                )
            )
            terminal_module_ids = {mid for (mid,) in result.all() if mid is not None}
            terminal_covering = expected <= terminal_module_ids

        if not terminal_covering:
            return False

        row.status = "ready"
        row.processing_import_job_id = None
        row.expected_modules = None
        await session.commit()

        await self._bus.publish("log.ready", {"user_id": row.user_id, "log_id": log_id})
        log.info("modules.processing.log_ready", log_id=log_id, user_id=row.user_id)
        return True

    async def on_terminal_job(self, payload: dict[str, Any]) -> None:
        """React to a terminal ``job.*`` event by re-checking the parent log.

        The payload is a platform ``job.completed|failed|cancelled`` envelope
        body. We load the job, and if it's a child of an ``event_log.import`` job
        (i.e. a module precompute run) we re-evaluate that log's completion.
        """
        job_id = payload.get("id")
        if not isinstance(job_id, str):
            return
        async with self._sessionmaker() as session:
            job = await session.get(Job, job_id)
            if job is None or job.parent_job_id is None:
                return
            parent = await session.get(Job, job.parent_job_id)
            if parent is None or parent.type != _IMPORT_JOB_TYPE:
                return
            log_id = parent.payload_json.get("log_id")
            if not isinstance(log_id, str):
                return
            await self.check_and_finalize(log_id, session)

    async def reconcile_boot(self, session: AsyncSession) -> None:
        """Re-evaluate every ``processing`` log once at startup.

        Module precompute jobs that finished while the API was down (or the
        terminal event that would have triggered the flip was dropped) leave a
        log stuck in ``processing``; this re-derives completion from the ``Job``
        rows so such a log un-gates on the next boot.
        """
        result = await session.execute(select(EventLog.id).where(EventLog.status == "processing"))
        log_ids = [lid for (lid,) in result.all()]
        for log_id in log_ids:
            try:
                await self.check_and_finalize(log_id, session)
            except Exception:
                log.exception("modules.processing.reconcile_failed", log_id=log_id)


_coordinator: ModuleProcessingCoordinator | None = None


def get_coordinator() -> ModuleProcessingCoordinator | None:
    """The process-global coordinator, or ``None`` before startup wires it.

    Returns ``None`` rather than raising so the ingest handler degrades to the
    legacy "ready immediately" path if it ever runs without a coordinator (e.g.
    a bare-runtime test) instead of failing the import.
    """
    return _coordinator


def set_coordinator(coordinator: ModuleProcessingCoordinator | None) -> None:
    global _coordinator
    _coordinator = coordinator
