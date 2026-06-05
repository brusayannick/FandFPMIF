"""FastAPI entry point.

Starts the SQLite engine (PRAGMAs applied lazily on first connect), the
DuckDB connection pool, and the asyncio job runtime with the import handler
registered.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import sys
from contextlib import asynccontextmanager

# Process trees discovered from real-world logs can nest deep enough to
# exceed CPython's default 1000-frame recursion limit when FastAPI's
# jsonable_encoder walks the response dict. Raising it once at import time
# is cheap and avoids a class of RecursionError → 500 failures on the
# /process-tree routes.
sys.setrecursionlimit(10_000)

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from mate.api import __version__
from mate.api.config import get_settings
from mate.api.db.engine import dispose_engine, get_sessionmaker
from mate.api.db.models import Job
from mate.api.duckdb.pool import get_duckdb_pool
from mate.api.events import EventBus, set_event_bus
from mate.api.ingest.dispatch import register_import_handler
from mate.api.jobs.runtime import JobRuntime, set_job_runtime
from mate.api.middleware import UsageTrackingMiddleware
from mate.api.modules import CapabilityRegistry, ModuleLoader, set_module_loader
from mate.api.modules.hot_reload import HotReload, sweep_stale_workdirs
from mate.api.modules.install_jobs import register_module_install_handlers
from mate.api.routes import v1
from mate.api.routes.analytics import prune_expired, record_server_event
from mate.api.schemas.common import HealthResponse

# Daily — re-evaluated every loop iteration against the current
# `analytics.config.retention_days` setting.
_RETENTION_INTERVAL_SECONDS = 24 * 60 * 60


async def _analytics_retention_loop() -> None:
    """Periodically prune analytics rows older than the configured window.

    A no-op when retention is unset; users on "forever" pay nothing. Errors
    are swallowed so a transient DB hiccup never tears down the loop.
    """
    log = structlog.get_logger("analytics.retention")
    sm = get_sessionmaker()
    while True:
        try:
            await asyncio.sleep(_RETENTION_INTERVAL_SECONDS)
            async with sm() as session:
                pruned = await prune_expired(session)
                if pruned:
                    log.info("analytics.retention.pruned", events=pruned)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("analytics.retention.failed", error=str(exc))


async def _job_event_recorder_loop(bus: EventBus) -> None:
    """Mirror job outcomes into the unified analytics stream as ``job`` events.

    Subscribes to the platform's terminal ``job.*`` topics and records one
    server-side analytics event per finished job, carrying the job type,
    status, module, and real runtime duration (from the ``jobs`` row). This is
    why the job runtime itself needs no tracking code. Gated per-user by
    ``record_server_event``; failures are swallowed so the bus keeps draining.
    """
    log = structlog.get_logger("usage.jobs")
    sm = get_sessionmaker()
    async with bus.subscribe(("job.completed", "job.failed", "job.cancelled")) as stream:
        async for envelope in stream:
            try:
                payload = envelope.payload
                job_id = payload.get("id")
                user_id = payload.get("user_id")
                if not job_id or not user_id:
                    continue
                async with sm() as session:
                    job = await session.get(Job, job_id)
                    if job is None:
                        continue
                    duration_ms: int | None = None
                    if job.started_at and job.finished_at:
                        duration_ms = int(
                            (job.finished_at - job.started_at).total_seconds() * 1000
                        )
                    await record_server_event(
                        session,
                        user_id=user_id,
                        event_type="job",
                        event_name=job.type,
                        duration_ms=duration_ms,
                        properties={
                            "job_id": job.id,
                            "status": job.status,
                            "module_id": job.module_id,
                            "error": (job.error or None) and job.error[:240],
                        },
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("usage.jobs.record_failed", error=str(exc))


def _configure_logging(level: str) -> None:
    logging.basicConfig(level=level.upper())
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
    )


def _purge_legacy_storage_once(settings) -> None:
    """One-shot wipe of pre-multi-user on-disk layout.

    The fresh-start migration in Alembic drops the rows for ``process_logs``
    etc. but leaves the parquet directories behind. Without this, the next
    boot would still have orphan ``data/event_logs/<id>/`` directories. We
    write a sentinel after the wipe so subsequent boots skip the check.
    """
    sentinel = settings.data_dir / ".multi_user_migrated"
    if sentinel.exists():
        return
    for legacy in (settings.data_dir / "event_logs", settings.data_dir / "module_results"):
        if legacy.exists():
            shutil.rmtree(legacy, ignore_errors=True)
    sentinel.parent.mkdir(parents=True, exist_ok=True)
    sentinel.write_text("multi-user storage layout active\n")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.ensure_dirs()
    _purge_legacy_storage_once(settings)
    _configure_logging(settings.log_level)

    bus = EventBus()
    set_event_bus(bus)

    runtime = JobRuntime(settings, bus=bus)
    register_import_handler(runtime)
    set_job_runtime(runtime)
    await runtime.start()

    registry = CapabilityRegistry()
    loader = ModuleLoader(
        modules_dir=settings.modules_dir.resolve(),
        uploaded_modules_dir=settings.uploaded_modules_dir.resolve(),
        bus=bus,
        runtime=runtime,
        registry=registry,
        api_app=app,
    )
    set_module_loader(loader)
    register_module_install_handlers(runtime, loader)
    try:
        await loader.load_all()
    except Exception:
        # Discovery failures should not prevent the platform from booting.
        # Bad manifests are logged inside the loader.
        pass

    # Sweep any `ff-mod-*` temp dirs older than 24h that earlier crashes left
    # behind (the per-invocation cleanup in `_invoke_handler` handles the
    # happy path; this catches SIGKILL/restart leaks).
    sweep_stale_workdirs()

    # Dev-only watchdog so module edits hot-reload without a restart (§5.3 #7).
    hot_reload: HotReload | None = None
    if settings.env == "dev":
        hot_reload = HotReload(loader)
        hot_reload.start()

    # Touch the DuckDB pool so the first request doesn't pay the init cost.
    get_duckdb_pool()

    retention_task = asyncio.create_task(_analytics_retention_loop())
    job_event_task = asyncio.create_task(_job_event_recorder_loop(bus))

    try:
        yield
    finally:
        for task in (retention_task, job_event_task):
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        if hot_reload is not None:
            hot_reload.stop()
        await loader.unload_all()
        set_module_loader(None)
        await runtime.stop()
        set_job_runtime(None)
        set_event_bus(None)
        get_duckdb_pool().close_all()
        await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Mate API",
        version=__version__,
        description="Backend for the Mate process analysis platform.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )
    # Times a curated allowlist of business operations and records them as
    # server-side analytics events (transparent to streaming responses).
    app.add_middleware(UsageTrackingMiddleware)
    app.include_router(v1)

    @app.get("/health", response_model=HealthResponse, tags=["meta"])
    async def health() -> HealthResponse:
        return HealthResponse(status="ok", version=__version__)

    return app


app = create_app()
