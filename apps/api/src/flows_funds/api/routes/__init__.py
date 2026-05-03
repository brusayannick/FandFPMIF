from fastapi import APIRouter

from flows_funds.api.routes.event_log_data import router as event_log_data_router
from flows_funds.api.routes.event_logs import router as event_logs_router
from flows_funds.api.routes.events_ws import router as events_ws_router
from flows_funds.api.routes.jobs import router as jobs_router
from flows_funds.api.routes.modules import router as modules_router

v1 = APIRouter(prefix="/api/v1")
v1.include_router(event_logs_router)
v1.include_router(event_log_data_router)
v1.include_router(jobs_router)
v1.include_router(modules_router)
v1.include_router(events_ws_router)

__all__ = ["v1"]
