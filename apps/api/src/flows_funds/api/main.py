"""FastAPI entry point.

Starts the SQLite engine (PRAGMAs applied lazily on first connect), the
DuckDB connection pool, and the asyncio job runtime with the import handler
registered.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from flows_funds.api import __version__
from flows_funds.api.config import get_settings
from flows_funds.api.db.engine import dispose_engine
from flows_funds.api.duckdb.pool import get_duckdb_pool
from flows_funds.api.events import EventBus, set_event_bus
from flows_funds.api.ingest.dispatch import register_import_handler
from flows_funds.api.jobs.runtime import JobRuntime, set_job_runtime
from flows_funds.api.modules import CapabilityRegistry, ModuleLoader, set_module_loader
from flows_funds.api.modules.install import register_install_handler
from flows_funds.api.routes import v1
from flows_funds.api.schemas.common import HealthResponse


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
    register_install_handler(runtime)
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
    try:
        await loader.load_all()
    except Exception:  # noqa: BLE001
        # Discovery failures should not prevent the platform from booting.
        # Bad manifests are logged inside the loader.
        pass

    # Touch the DuckDB pool so the first request doesn't pay the init cost.
    get_duckdb_pool()

    try:
        yield
    finally:
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
