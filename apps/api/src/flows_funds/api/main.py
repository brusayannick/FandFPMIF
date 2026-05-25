"""FastAPI entry point.

Starts the SQLite engine (PRAGMAs applied lazily on first connect), the
DuckDB connection pool, and the asyncio job runtime with the import handler
registered.
"""

from __future__ import annotations

import asyncio
import logging
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

from flows_funds.api import __version__
from flows_funds.api.config import get_settings
from flows_funds.api.db.engine import dispose_engine, get_sessionmaker
from flows_funds.api.duckdb.pool import get_duckdb_pool
from flows_funds.api.events import EventBus, set_event_bus
from flows_funds.api.ingest.dispatch import register_import_handler
from flows_funds.api.jobs.runtime import JobRuntime, set_job_runtime
from flows_funds.api.modules import CapabilityRegistry, ModuleLoader, set_module_loader
from flows_funds.api.modules.hot_reload import HotReload, sweep_stale_workdirs
from flows_funds.api.modules.install_jobs import register_module_install_handlers
from flows_funds.api.routes import v1
from flows_funds.api.routes.analytics import prune_expired
from flows_funds.api.schemas.common import HealthResponse

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.ensure_dirs()
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

    try:
        yield
    finally:
        retention_task.cancel()
        try:
            await retention_task
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
        title="Flows & Funds API",
        version=__version__,
        description="Backend for the Flows & Funds process analysis platform.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )
    app.include_router(v1)

    @app.get("/health", response_model=HealthResponse, tags=["meta"])
    async def health() -> HealthResponse:
        return HealthResponse(status="ok", version=__version__)

    return app


app = create_app()
