"""Backend-switch data migration (S3_OFFLOAD Phase 3.1).

Switching the storage backend doesn't move existing data - new writes go to the
new backend, old data stays where it was (stranded). This copies it: a
``storage.migrate`` job walks every per-log + per-module cache dir and pushes it
to S3 (``to_s3``, after a local→s3 switch) or pulls it down (``to_local``, before
an s3→local switch).

Copy-only - it NEVER deletes the source, so it's always safe to re-run and needs
no destructive-action confirm. Both directions require S3 to be the active
backend (the job reads/writes the bucket), so run ``to_local`` BEFORE flipping
the config back to local.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path

import structlog

from mate.api.config import get_settings
from mate.api.jobs.runtime import JobHandle, JobRuntime
from mate.api.storage import eviction, s3
from mate.api.storage import sync as storage_sync
from mate.api.storage.config import get_storage_settings, is_s3

log = structlog.get_logger(__name__)

MIGRATION_JOB_TYPE = "storage.migrate"


def _s3_cache_dirs() -> list[Path]:
    """Local dir paths that have objects under the bucket's ``users/`` prefix.

    Parses each key back to its cache-dir granularity - ``users/{uid}/event_logs/
    {lid}`` and ``users/{uid}/module_results/{lid}/{mid}`` - so a pull hydrates the
    same units ``persist``/``hydrate`` move.
    """
    data_dir = get_settings().data_dir.resolve()
    admin_prefix = get_storage_settings().prefix.strip("/")
    base = f"{admin_prefix}/users/" if admin_prefix else "users/"
    dirs: set[Path] = set()
    for obj in s3.list_objects(base):
        key = obj.key
        rel = key[len(admin_prefix) + 1 :] if admin_prefix else key
        parts = rel.split("/")
        # users/{uid}/event_logs/{lid}/...  |  users/{uid}/module_results/{lid}/{mid}/...
        if len(parts) >= 4 and parts[0] == "users" and parts[2] == "event_logs":
            dirs.add(data_dir.joinpath(*parts[:4]))
        elif len(parts) >= 5 and parts[0] == "users" and parts[2] == "module_results":
            dirs.add(data_dir.joinpath(*parts[:5]))
    return sorted(dirs)


def _push_one(local_dir: Path) -> bool:
    """Upload a local dir to S3 and confirm the remote copy exists."""
    storage_sync.persist_dir_sync(local_dir)
    return s3.prefix_nonempty(storage_sync.rel_key(local_dir))


def _pull_one(local_dir: Path) -> bool:
    """Force-download a dir from S3 (bypasses the warm-cache hydrate short-circuit)."""
    s3.download_prefix(storage_sync.rel_key(local_dir), local_dir)
    return local_dir.exists() and any(local_dir.iterdir())


async def _run(
    handle: JobHandle, dirs: list[Path], fn: Callable[[Path], bool], verb: str
) -> None:
    total = len(dirs)
    await handle.progress(0, total or 1, stage="migrating", message=f"{verb}: {total} dirs")
    ok = 0
    failed = 0
    for i, d in enumerate(dirs, 1):
        handle.raise_if_cancelled()
        try:
            if await asyncio.to_thread(fn, d):
                ok += 1
            else:
                failed += 1
                log.warning("storage.migrate.dir_unverified", dir=str(d))
        except Exception:
            failed += 1
            log.warning("storage.migrate.dir_failed", dir=str(d), exc_info=True)
        await handle.progress(i, total or 1, stage="migrating", message=f"{verb}: {i}/{total}")
    handle.payload["migrated"] = ok
    handle.payload["failed"] = failed
    await handle.progress(
        total or 1, total or 1, stage="done", message=f"Migrated {ok}/{total} ({failed} failed)"
    )
    log.info("storage.migrate.complete", verb=verb, migrated=ok, failed=failed, total=total)


def _make_handler():
    async def handler(handle: JobHandle) -> None:
        direction = handle.payload.get("direction")
        if not is_s3():
            raise RuntimeError("Migration requires the S3 backend to be active.")
        if direction == "to_s3":
            dirs = await asyncio.to_thread(eviction.cache_dirs)
            await _run(handle, dirs, _push_one, "Uploading")
        elif direction == "to_local":
            dirs = await asyncio.to_thread(_s3_cache_dirs)
            await _run(handle, dirs, _pull_one, "Downloading")
        else:
            raise ValueError(f"Unknown migration direction: {direction!r}")

    return handler


def register_storage_migration_handler(runtime: JobRuntime) -> None:
    """Wire the ``storage.migrate`` job type onto the runtime (idempotent)."""
    if MIGRATION_JOB_TYPE in runtime._handlers:  # type: ignore[attr-defined]
        return
    runtime.register(MIGRATION_JOB_TYPE, _make_handler())
