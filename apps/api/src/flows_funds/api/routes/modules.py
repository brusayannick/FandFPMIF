"""/api/v1/modules — list manifests, per-log availability, get/put config.

Module-defined routes are mounted by the loader (phase 5) directly onto the
app under ``/api/v1/modules/{id}/...`` — they do **not** go through this
router; this router covers the platform's own module-meta surface.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from flows_funds.api.config import get_settings
from flows_funds.api.db.models import EventLog, ModuleConfig, ModuleLayout
from flows_funds.api.db.session import SessionDep
from flows_funds.api.jobs.runtime import get_job_runtime
from flows_funds.api.modules import get_module_loader
from flows_funds.api.modules.availability import Availability
from flows_funds.api.modules.install_jobs import (
    JOB_TYPE_GIT,
    JOB_TYPE_REGISTRY,
    JOB_TYPE_UPLOAD,
)
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


class GitInstallPayload(BaseModel):
    url: str = Field(..., min_length=1)
    ref: str | None = None


class RegistryInstallPayload(BaseModel):
    source: str = Field(..., pattern="^(pypi|npm)$")
    id: str = Field(..., min_length=1)
    version: str | None = None


class InstallJobResponse(BaseModel):
    job_id: str


_ALLOWED_UPLOAD_SUFFIXES = (".zip", ".tar", ".tar.gz", ".tgz")


def _has_allowed_upload_suffix(name: str) -> bool:
    lowered = name.lower()
    return any(lowered.endswith(s) for s in _ALLOWED_UPLOAD_SUFFIXES)


@router.post("/install", response_model=InstallJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def install_from_upload(file: UploadFile = File(...)) -> InstallJobResponse:
    """Accept a zip / tar.gz, persist it to a staging dir, and submit a job
    that unpacks and registers the module. Returns the job id so the dock can
    stream progress (`WS /api/v1/events` filtered by `job.*`).
    """
    filename = file.filename or "upload"
    if not _has_allowed_upload_suffix(filename):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported archive format. Accepted: {', '.join(_ALLOWED_UPLOAD_SUFFIXES)}.",
        )
    settings = get_settings()
    staging_dir = settings.data_dir / "module-uploads"
    staging_dir.mkdir(parents=True, exist_ok=True)
    fd, raw_path = tempfile.mkstemp(prefix="upload-", suffix=Path(filename).suffix, dir=staging_dir)
    archive_path = Path(raw_path)
    # Stream the upload to disk so we don't hold huge payloads in memory.
    try:
        with open(fd, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                out.write(chunk)
    except Exception:
        archive_path.unlink(missing_ok=True)
        raise
    runtime = get_job_runtime()
    job_id = await runtime.submit(
        type_=JOB_TYPE_UPLOAD,
        title=f"Install module — {filename}",
        subtitle="Unpacking and registering",
        payload={"archive_path": str(archive_path), "original_name": filename},
    )
    return InstallJobResponse(job_id=job_id)


@router.post(
    "/install/git", response_model=InstallJobResponse, status_code=status.HTTP_202_ACCEPTED
)
async def install_from_git(payload: GitInstallPayload) -> InstallJobResponse:
    runtime = get_job_runtime()
    title = f"Install module — {payload.url.rsplit('/', 1)[-1]}"
    if payload.ref:
        title += f" ({payload.ref})"
    job_id = await runtime.submit(
        type_=JOB_TYPE_GIT,
        title=title,
        subtitle="Cloning and registering",
        payload={"url": payload.url, "ref": payload.ref},
    )
    return InstallJobResponse(job_id=job_id)


@router.post(
    "/install/registry",
    response_model=InstallJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def install_from_registry(payload: RegistryInstallPayload) -> InstallJobResponse:
    runtime = get_job_runtime()
    title = f"Install module — {payload.source}:{payload.id}"
    if payload.version:
        title += f"@{payload.version}"
    job_id = await runtime.submit(
        type_=JOB_TYPE_REGISTRY,
        title=title,
        subtitle="Fetching from registry",
        payload={"source": payload.source, "id": payload.id, "version": payload.version},
    )
    return InstallJobResponse(job_id=job_id)


class ModuleLayoutPayload(BaseModel):
    layout: dict[str, Any] = Field(default_factory=dict)


@router.get("/{module_id}/layout", response_model=ModuleLayoutPayload)
async def get_module_layout(
    module_id: str,
    session: SessionDep,
    log_id: Annotated[str, Query(..., min_length=1)],
    user_id: Annotated[str, Query()] = "local",
) -> ModuleLayoutPayload:
    """Return the saved layout JSON for this `(user, log, module)` triple, or
    an empty object if none saved (§7.7). Frontend uses this to restore
    react-grid-layout positions across reloads.
    """
    row = await session.get(ModuleLayout, (user_id, log_id, module_id))
    return ModuleLayoutPayload(layout=row.layout_json if row else {})


@router.put("/{module_id}/layout", response_model=ModuleLayoutPayload)
async def put_module_layout(
    module_id: str,
    session: SessionDep,
    payload: ModuleLayoutPayload,
    log_id: Annotated[str, Query(..., min_length=1)],
    user_id: Annotated[str, Query()] = "local",
) -> ModuleLayoutPayload:
    row = await session.get(ModuleLayout, (user_id, log_id, module_id))
    if row is None:
        row = ModuleLayout(
            user_id=user_id, log_id=log_id, module_id=module_id, layout_json=payload.layout
        )
        session.add(row)
    else:
        row.layout_json = payload.layout
    await session.commit()
    return payload


@router.get("/{module_id}/assets/{asset_path:path}")
async def get_module_asset(module_id: str, asset_path: str) -> FileResponse:
    """Serve a file from `modules/<id>/.dist/` (§5.4).

    The frontend dynamic loader fetches `panel.js` / `widget-*.js` from this
    route, runs them through a CJS shim that resolves `require(...)` against
    `window.__FF_RUNTIME__`. Layout matches what
    `apps/web/scripts/bundle-modules.mjs` writes at build time / dev watch.
    """
    settings = get_settings()
    dist_root = (settings.modules_dir / module_id / ".dist").resolve()
    # Reject path traversal — resolve() collapses `..` so the prefix check is
    # what actually enforces containment.
    candidate = (dist_root / asset_path).resolve()
    try:
        candidate.relative_to(dist_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid asset path.") from exc
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    # Force application/javascript so the browser executes the file as JS
    # even if the on-disk extension is unusual.
    media_type = "application/javascript" if candidate.suffix == ".js" else None
    return FileResponse(candidate, media_type=media_type)


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
