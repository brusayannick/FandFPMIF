"""/api/v1/modules — list manifests, per-log availability, get/put config.

Module-defined routes are mounted by the loader (phase 5) directly onto the
app under ``/api/v1/modules/{id}/...`` — they do **not** go through this
router; this router covers the platform's own module-meta surface.
"""

from __future__ import annotations

import shutil
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select

from flows_funds.api.config import get_settings
from flows_funds.api.db.models import EventLog, ModuleConfig
from flows_funds.api.db.session import SessionDep
from flows_funds.api.modules import get_module_loader
from flows_funds.api.modules.availability import Availability
from flows_funds.api.modules.installer import remove_module_artifacts

router = APIRouter(prefix="/modules", tags=["modules"])


class ModuleSummary(BaseModel):
    id: str
    name: str
    version: str
    category: str
    description: str | None = None
    author: str | None = None
    license: str | None = None
    provides: list[str]
    consumes: list[str]
    has_frontend: bool
    enabled: bool = True
    availability: Availability | None = None


class ModuleConfigPayload(BaseModel):
    config: dict[str, Any] = {}
    enabled: bool = True


@router.get("", response_model=list[ModuleSummary])
async def list_modules(
    session: SessionDep,
    log_id: Annotated[str | None, Query()] = None,
) -> list[ModuleSummary]:
    try:
        loader = get_module_loader()
    except HTTPException:
        return []
    manifests = loader.manifests()
    if not manifests:
        return []

    avail_map: dict[str, Availability] = {}
    if log_id is not None:
        log_row = await session.get(EventLog, log_id)
        if log_row is None or log_row.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Event log not found.")
        avail_map = loader.availability_for(
            detected_schema=log_row.detected_schema,
            events_count=log_row.events_count,
            cases_count=log_row.cases_count,
        )

    rows = await session.execute(select(ModuleConfig.module_id, ModuleConfig.enabled))
    enabled_map: dict[str, bool] = {module_id: enabled for module_id, enabled in rows.all()}

    return [
        ModuleSummary(
            id=m.id,
            name=m.name,
            version=m.version,
            category=m.category,
            description=m.description,
            author=m.author,
            license=m.license,
            provides=list(m.provides),
            consumes=list(m.consumes),
            has_frontend=bool(m.frontend.panel),
            enabled=enabled_map.get(m.id, m.default_enabled),
            availability=avail_map.get(m.id),
        )
        for m in manifests
    ]


@router.get("/{module_id}/manifest")
async def get_manifest(module_id: str) -> dict[str, Any]:
    try:
        loader = get_module_loader()
    except HTTPException as exc:
        raise exc
    loaded = loader.loaded.get(module_id)
    if loaded is None:
        raise HTTPException(
            status_code=404,
            detail=f"Module {module_id!r} is not loaded.",
        )
    return loaded.manifest.model_dump(by_alias=True)


@router.get("/{module_id}/config-schema")
async def get_config_schema(module_id: str) -> dict[str, Any]:
    try:
        loader = get_module_loader()
    except HTTPException as exc:
        raise exc
    loaded = loader.loaded.get(module_id)
    if loaded is None:
        raise HTTPException(
            status_code=404,
            detail=f"Module {module_id!r} is not loaded.",
        )
    return loaded.manifest.config_schema or {}


@router.get("/{module_id}/config", response_model=ModuleConfigPayload)
async def get_config(module_id: str, session: SessionDep) -> ModuleConfigPayload:
    row = await session.get(ModuleConfig, module_id)
    if row is None:
        return ModuleConfigPayload(config={}, enabled=True)
    return ModuleConfigPayload(config=row.config_json, enabled=row.enabled)


@router.put("/{module_id}/config", response_model=ModuleConfigPayload)
async def put_config(
    module_id: str,
    payload: ModuleConfigPayload,
    session: SessionDep,
) -> ModuleConfigPayload:
    row = await session.get(ModuleConfig, module_id)
    if row is None:
        row = ModuleConfig(module_id=module_id, config_json=payload.config, enabled=payload.enabled)
        session.add(row)
    else:
        row.config_json = payload.config
        row.enabled = payload.enabled
    await session.commit()
    return payload


@router.delete("/{module_id}", status_code=status.HTTP_204_NO_CONTENT)
async def uninstall(module_id: str) -> None:
    settings = get_settings()
    target = settings.modules_dir.resolve() / module_id
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Module {module_id!r} is not installed.")
    loader = get_module_loader()
    await loader.unload_one(module_id)
    remove_module_artifacts(target)
    shutil.rmtree(target, ignore_errors=True)
    await loader.bus.publish("module.uninstalled", {"id": module_id})
