from fastapi import APIRouter

from flows_funds.api.routes.admin import router as admin_router
from flows_funds.api.routes.ai import router as ai_router
from flows_funds.api.routes.ai_guidance import router as ai_guidance_router
from flows_funds.api.routes.analytics import router as analytics_router
from flows_funds.api.routes.event_log_data import router as event_log_data_router
from flows_funds.api.routes.event_logs import router as event_logs_router
from flows_funds.api.routes.events_ws import router as events_ws_router
from flows_funds.api.routes.folders import router as folders_router
from flows_funds.api.routes.jobs import router as jobs_router
from flows_funds.api.routes.modules import router as modules_router
from flows_funds.api.routes.onboarding import router as onboarding_router
from flows_funds.api.routes.preferences import router as preferences_router
from flows_funds.api.routes.system import router as system_router

v1 = APIRouter(prefix="/api/v1")
v1.include_router(admin_router)
v1.include_router(event_logs_router)
v1.include_router(event_log_data_router)
v1.include_router(folders_router)
v1.include_router(jobs_router)
v1.include_router(modules_router)
v1.include_router(system_router)
v1.include_router(ai_router)
v1.include_router(ai_guidance_router)
v1.include_router(analytics_router)
v1.include_router(onboarding_router)
v1.include_router(preferences_router)
v1.include_router(events_ws_router)

__all__ = ["v1"]
