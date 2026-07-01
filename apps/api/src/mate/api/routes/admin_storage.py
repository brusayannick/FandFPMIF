"""/api/v1/admin/storage - connect & manage the storage backend (admin only).

Lets an administrator switch the platform between local-disk storage (dev/test)
and an S3/Ceph-RGW bucket as the durable primary store (prod), enter the bucket
connection details, test them, and see a usage overview. Gated by the same
Keycloak ``admin`` realm role as the data export. See
``mate.api.storage`` for the backend and ``apps/web/app/(platform)/admin/storage``
for the UI.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from mate.api.auth import ADMIN_ROLE, AdminUserDep, CurrentUserDep
from mate.api.db.models import StorageConfig
from mate.api.db.session import SessionDep
from mate.api.jobs.runtime import get_job_runtime
from mate.api.storage import eviction, s3
from mate.api.storage.config import (
    StorageSettings,
    encrypt_secret,
    get_storage_settings,
    invalidate,
)
from mate.api.storage.migration import MIGRATION_JOB_TYPE

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/admin/storage", tags=["admin"])


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------


class StorageConfigOut(BaseModel):
    is_admin: bool
    mode: str = "local"
    endpoint_url: str | None = None
    bucket: str | None = None
    region: str | None = None
    access_key: str | None = None
    # We never return the secret - only whether one is stored. The form shows a
    # "leave blank to keep" placeholder when this is true.
    secret_set: bool = False
    path_style: bool = True
    use_ssl: bool = True
    prefix: str = ""
    quota_bytes: int | None = None


class StorageConfigIn(BaseModel):
    mode: str = Field(default="local", pattern="^(local|s3)$")
    endpoint_url: str | None = None
    bucket: str | None = None
    region: str | None = None
    access_key: str | None = None
    # Blank/omitted = keep the existing stored secret.
    secret_key: str | None = None
    path_style: bool = True
    use_ssl: bool = True
    prefix: str = ""
    quota_bytes: int | None = Field(default=None, ge=0)


class TestResult(BaseModel):
    ok: bool
    message: str


class UsageOut(BaseModel):
    mode: str
    used_bytes: int = 0
    object_count: int = 0
    quota_bytes: int | None = None
    error: str | None = None


class CacheConfigOut(BaseModel):
    # In S3 mode local disk is a reclaimable cache; these tune the reaper that
    # bounds it (see S3_OFFLOAD.md). ``enabled`` reflects S3 mode + a budget set.
    enabled: bool = False
    max_bytes: int = 0
    dry_run: bool = True
    min_age_seconds: int = 600
    local_used_bytes: int = 0


class CacheConfigIn(BaseModel):
    max_bytes: int = Field(default=0, ge=0)
    dry_run: bool = True
    min_age_seconds: int = Field(default=600, ge=0)


class MigrateIn(BaseModel):
    # ``to_s3``: push existing local data up after a local→s3 switch.
    # ``to_local``: pull S3 data down before flipping back to local.
    direction: str = Field(pattern="^(to_s3|to_local)$")


class MigrateOut(BaseModel):
    job_id: str


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


async def _get_or_create(session: SessionDep) -> StorageConfig:
    row = await session.get(StorageConfig, StorageConfig.SINGLETON_ID)
    if row is None:
        row = StorageConfig(id=StorageConfig.SINGLETON_ID)
        session.add(row)
    return row


def _settings_from_in(body: StorageConfigIn, fallback_secret: str | None) -> StorageSettings:
    """Build live settings from a request body, reusing the stored secret when
    the body leaves it blank (so 'Test' works without re-typing the secret)."""
    return StorageSettings(
        mode=body.mode,
        endpoint_url=body.endpoint_url,
        bucket=body.bucket,
        region=body.region,
        access_key=body.access_key,
        secret_key=body.secret_key or fallback_secret,
        path_style=body.path_style,
        use_ssl=body.use_ssl,
        prefix=body.prefix,
        quota_bytes=body.quota_bytes,
    )


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------


@router.get("/config", response_model=StorageConfigOut)
async def get_config(user: CurrentUserDep, session: SessionDep) -> StorageConfigOut:
    """Current storage config (secret never returned), plus ``is_admin``.

    Uses ``CurrentUserDep`` (not admin) so the page can render a "needs admin"
    state instead of a hard 403 for non-admins - mirrors ``admin.export_info``.
    """
    if ADMIN_ROLE not in user.roles:
        return StorageConfigOut(is_admin=False)

    row = await session.get(StorageConfig, StorageConfig.SINGLETON_ID)
    if row is None:
        return StorageConfigOut(is_admin=True)
    return StorageConfigOut(
        is_admin=True,
        mode=row.mode,
        endpoint_url=row.endpoint_url,
        bucket=row.bucket,
        region=row.region,
        access_key=row.access_key,
        secret_set=bool(row.secret_key_enc),
        path_style=row.path_style,
        use_ssl=row.use_ssl,
        prefix=row.prefix,
        quota_bytes=row.quota_bytes,
    )


@router.put("/config", response_model=StorageConfigOut)
async def put_config(
    body: StorageConfigIn, user: AdminUserDep, session: SessionDep
) -> StorageConfigOut:
    """Validate + persist the storage config. Encrypts a newly-provided secret;
    a blank secret keeps the stored one. Switching to S3 requires a complete,
    credentialed connection."""
    row = await _get_or_create(session)

    if body.mode == "s3":
        missing = [
            name
            for name, val in (
                ("endpoint URL", body.endpoint_url),
                ("bucket", body.bucket),
                ("access key", body.access_key),
            )
            if not (val and val.strip())
        ]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"S3 mode requires: {', '.join(missing)}.",
            )
        if not (body.secret_key and body.secret_key.strip()) and not row.secret_key_enc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="S3 mode requires a secret key.",
            )

    row.mode = body.mode
    row.endpoint_url = (body.endpoint_url or "").strip() or None
    row.bucket = (body.bucket or "").strip() or None
    row.region = (body.region or "").strip() or None
    row.access_key = (body.access_key or "").strip() or None
    if body.secret_key and body.secret_key.strip():
        row.secret_key_enc = encrypt_secret(body.secret_key.strip())
    row.path_style = body.path_style
    row.use_ssl = body.use_ssl
    row.prefix = (body.prefix or "").strip().strip("/")
    row.quota_bytes = body.quota_bytes
    await session.commit()
    invalidate()  # next read (incl. sync hooks) reflects the new config
    log.info("admin_storage_config_saved", admin_id=user.id, mode=row.mode)

    return StorageConfigOut(
        is_admin=True,
        mode=row.mode,
        endpoint_url=row.endpoint_url,
        bucket=row.bucket,
        region=row.region,
        access_key=row.access_key,
        secret_set=bool(row.secret_key_enc),
        path_style=row.path_style,
        use_ssl=row.use_ssl,
        prefix=row.prefix,
        quota_bytes=row.quota_bytes,
    )


@router.post("/test", response_model=TestResult)
async def test_connection(body: StorageConfigIn, user: AdminUserDep) -> TestResult:
    """Validate the posted (or saved) S3 connection without persisting it."""
    fallback_secret = get_storage_settings().secret_key
    settings = _settings_from_in(body, fallback_secret)
    if not settings.endpoint_url or not settings.bucket:
        return TestResult(ok=False, message="Endpoint URL and bucket are required.")

    def _probe() -> None:
        s3.head_bucket(settings)
        # A 1-object list confirms list permission on top of bucket access.
        s3.make_client(settings).list_objects_v2(Bucket=settings.bucket, MaxKeys=1)

    try:
        await run_in_threadpool(_probe)
    except s3.StorageError as exc:
        return TestResult(ok=False, message=str(exc))
    except Exception as exc:
        return TestResult(ok=False, message=str(exc))
    return TestResult(ok=True, message=f"Connected to bucket “{settings.bucket}”.")


@router.get("/usage", response_model=UsageOut)
async def get_usage(user: AdminUserDep) -> UsageOut:
    """Bytes used + object count under the configured prefix, vs the quota."""
    s = get_storage_settings()
    if not s.is_s3:
        return UsageOut(mode=s.mode)
    try:
        used = await run_in_threadpool(s3.usage, s.prefix, s)
    except s3.StorageError as exc:
        return UsageOut(mode=s.mode, quota_bytes=s.quota_bytes, error=str(exc))
    return UsageOut(
        mode=s.mode,
        used_bytes=used.used_bytes,
        object_count=used.object_count,
        quota_bytes=s.quota_bytes,
    )


@router.get("/cache", response_model=CacheConfigOut)
async def get_cache_config(user: AdminUserDep) -> CacheConfigOut:
    """Current local-cache reaper config (env defaults + live override) plus the
    bytes the cache occupies on local disk right now."""
    cfg = await eviction.load_eviction_config()
    used = await run_in_threadpool(eviction.local_cache_bytes)
    return CacheConfigOut(
        enabled=get_storage_settings().is_s3 and cfg.max_bytes > 0,
        max_bytes=cfg.max_bytes,
        dry_run=cfg.dry_run,
        min_age_seconds=int(cfg.min_age_seconds),
        local_used_bytes=used,
    )


@router.post("/migrate", response_model=MigrateOut)
async def migrate_data(body: MigrateIn, user: AdminUserDep) -> MigrateOut:
    """Submit a copy-only data migration between backends as a tracked job.

    Both directions read/write the bucket, so S3 must be the active backend - run
    ``to_local`` BEFORE switching the config back to local. The job never deletes
    the source; watch it in Admin → Jobs.
    """
    if not get_storage_settings().is_s3:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Migration requires the S3 backend to be active. Switch to S3 first.",
        )
    job_id = await get_job_runtime().submit(
        type_=MIGRATION_JOB_TYPE,
        user_id=user.id,
        title=f"Storage migration ({body.direction})",
        subtitle="storage.migrate",
        payload={"direction": body.direction},
    )
    log.info("admin_storage_migrate_submitted", admin_id=user.id, direction=body.direction)
    return MigrateOut(job_id=job_id)


@router.put("/cache", response_model=CacheConfigOut)
async def put_cache_config(body: CacheConfigIn, user: AdminUserDep) -> CacheConfigOut:
    """Persist a live override of the reaper budget / dry-run flag (no restart).

    Stored in ``system_settings`` under ``storage.cache``; the reaper re-reads it
    each tick. Setting ``max_bytes`` to 0 disables eviction (local disk keeps
    every synced copy)."""
    await eviction.save_eviction_config(body.max_bytes, body.dry_run, body.min_age_seconds)
    log.info(
        "admin_storage_cache_saved",
        admin_id=user.id,
        max_bytes=body.max_bytes,
        dry_run=body.dry_run,
    )
    used = await run_in_threadpool(eviction.local_cache_bytes)
    return CacheConfigOut(
        enabled=get_storage_settings().is_s3 and body.max_bytes > 0,
        max_bytes=body.max_bytes,
        dry_run=body.dry_run,
        min_age_seconds=body.min_age_seconds,
        local_used_bytes=used,
    )
