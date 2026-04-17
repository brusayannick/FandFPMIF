from __future__ import annotations

from sqlalchemy import select

from fastapi import APIRouter, HTTPException, status

from core.dependencies import SessionDep
from models.process import ModuleConfig
from modules.registry import registry
from schemas.process import (
    ModuleList,
    ModuleManifest,
    ModuleConfigResponse,
    ModuleConfigUpdate,
)


router = APIRouter()


@router.get("", response_model=ModuleList)
async def list_modules() -> ModuleList:
    return ModuleList(modules=registry.list_manifests())


@router.get("/{module_id}", response_model=ModuleManifest)
async def get_module(module_id: str) -> ModuleManifest:
    module = registry.get(module_id)
    if module is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Module {module_id!r} not found")
    try:
        schema = module.get_config_schema().model_json_schema()
    except Exception:
        schema = None
    return ModuleManifest(
        module_id=module.module_id,
        display_name=module.display_name,
        version=module.version,
        description=module.description,
        config_schema=schema,
    )


@router.get("/{module_id}/config", response_model=ModuleConfigResponse)
async def get_module_config(module_id: str, session: SessionDep) -> ModuleConfigResponse:
    module = registry.get(module_id)
    if module is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Module {module_id!r} not found")

    row = await session.scalar(
        select(ModuleConfig).where(ModuleConfig.module_id == module_id)
    )
    if row is None:
        # Return defaults from schema
        try:
            schema_model = module.get_config_schema()
            defaults = schema_model().model_dump()
        except Exception:
            defaults = {}
        return ModuleConfigResponse(module_id=module_id, config=defaults, enabled=True)

    return ModuleConfigResponse(
        module_id=row.module_id,
        config=row.config,
        enabled=row.enabled,
        updated_at=row.updated_at,
    )


@router.put("/{module_id}/config", response_model=ModuleConfigResponse)
async def update_module_config(
    module_id: str, body: ModuleConfigUpdate, session: SessionDep
) -> ModuleConfigResponse:
    module = registry.get(module_id)
    if module is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Module {module_id!r} not found")

    row = await session.scalar(
        select(ModuleConfig).where(ModuleConfig.module_id == module_id)
    )
    if row is None:
        row = ModuleConfig(module_id=module_id, config=body.config, enabled=body.enabled)
        session.add(row)
    else:
        row.config = body.config
        row.enabled = body.enabled

    await session.commit()
    await session.refresh(row)

    return ModuleConfigResponse(
        module_id=row.module_id,
        config=row.config,
        enabled=row.enabled,
        updated_at=row.updated_at,
    )
