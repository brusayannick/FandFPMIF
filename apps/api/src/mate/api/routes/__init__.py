from fastapi import APIRouter

from mate.api.routes.admin import router as admin_router
from mate.api.routes.admin_storage import router as admin_storage_router
from mate.api.routes.ai import router as ai_router
from mate.api.routes.ai_guidance import router as ai_guidance_router
from mate.api.routes.analytics import router as analytics_router
from mate.api.routes.dashboards import router as dashboards_router
from mate.api.routes.event_log_data import router as event_log_data_router
from mate.api.routes.event_logs import router as event_logs_router
from mate.api.routes.events_ws import router as events_ws_router
from mate.api.routes.folders import router as folders_router
from mate.api.routes.jobs import router as jobs_router
from mate.api.routes.modules import router as modules_router
from mate.api.routes.ocel_data import router as ocel_data_router
from mate.api.routes.onboarding import router as onboarding_router
from mate.api.routes.preferences import router as preferences_router
from mate.api.routes.system import router as system_router

v1 = APIRouter(prefix="/api/v1")
v1.include_router(admin_router)
v1.include_router(admin_storage_router)
v1.include_router(event_logs_router)
v1.include_router(event_log_data_router)
v1.include_router(ocel_data_router)
v1.include_router(folders_router)
v1.include_router(jobs_router)
v1.include_router(modules_router)
v1.include_router(system_router)
v1.include_router(ai_router)
v1.include_router(ai_guidance_router)
v1.include_router(analytics_router)
v1.include_router(onboarding_router)
v1.include_router(preferences_router)
v1.include_router(dashboards_router)
v1.include_router(events_ws_router)

__all__ = ["v1"]
