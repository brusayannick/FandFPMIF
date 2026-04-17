from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings
from core.database import init_db
from modules.builtin.analytics.module import ProcessAnalyticsModule
from modules.builtin.event_log_importer.module import EventLogImporterModule
from modules.builtin.importer.module import BpmnImporterModule
from modules.builtin.simulation.module import ProcessSimulationModule
from modules.registry import registry
from routers import dashboard as dashboard_router
from routers import modules as modules_router
from routers import processes as processes_router


settings = get_settings()


def _register_builtin_modules() -> None:
    if registry.get("process_analytics") is None:
        registry.register(ProcessAnalyticsModule())
    if registry.get("process_simulation") is None:
        registry.register(ProcessSimulationModule())
    if registry.get("bpmn_importer") is None:
        registry.register(BpmnImporterModule())
    if registry.get("event_log_importer") is None:
        registry.register(EventLogImporterModule())


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    _register_builtin_modules()
    registry.mount_all(app, api_prefix=settings.api_prefix)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Flows & Funds — Process Analysis API",
        version="0.1.0",
        description=(
            "Backend for the Process Analysis Tool. Hosts the process CRUD "
            "endpoints, graph validation, and the module registry."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(
        processes_router.router,
        prefix=f"{settings.api_prefix}/processes",
        tags=["processes"],
    )
    app.include_router(
        modules_router.router,
        prefix=f"{settings.api_prefix}/modules",
        tags=["modules"],
    )
    app.include_router(
        dashboard_router.router,
        prefix=f"{settings.api_prefix}/dashboard",
        tags=["dashboard"],
    )

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "environment": settings.environment}

    return app


app = create_app()
