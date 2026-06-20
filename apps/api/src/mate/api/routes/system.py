"""System-level diagnostics — disk usage, version, copy-diagnostics blob.

Backs the *Settings → General → Data & storage* gauge and the *Settings →
About → Copy diagnostics* button (§7.6.1, §7.6.3).
"""

from __future__ import annotations

import asyncio
import platform
import shutil
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from mate.api import __version__
from mate.api.auth import CurrentUserDep
from mate.api.config import get_settings
from mate.api.modules import get_module_loader

router = APIRouter(prefix="/system", tags=["system"])


def _dir_size_bytes(path: Path, *, max_entries: int = 100_000) -> int:
    """Recursive byte total under `path`. Bounded scan so a pathological
    deeply-nested module folder can't lock the request indefinitely.
    """
    total = 0
    visited = 0
    for entry in path.rglob("*"):
        visited += 1
        if visited > max_entries:
            break
        try:
            if entry.is_file():
                total += entry.stat().st_size
        except OSError:
            continue
    return total


@router.get("/storage")
async def storage(user: CurrentUserDep) -> dict[str, Any]:
    """Disk usage breakdown for the platform's bind-mounted data + modules
    directories, plus filesystem total/free so the frontend can render a
    gauge. All values in bytes.
    """
    settings = get_settings()
    data_dir = settings.data_dir.resolve()
    modules_dir = settings.modules_dir.resolve()
    try:
        usage = shutil.disk_usage(data_dir if data_dir.exists() else data_dir.parent)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"shutil.disk_usage failed: {exc}") from exc
    # The recursive size walk can touch tens of thousands of files (uv caches,
    # module venvs, parquet) on a slow bind-mount. Run it off the event loop so
    # it can't stall every other request (including /health) for minutes.
    by_dir: dict[str, int] = {}
    for label, p in (("data", data_dir), ("modules", modules_dir)):
        by_dir[label] = await asyncio.to_thread(_dir_size_bytes, p) if p.exists() else 0
    return {
        "fs_total": usage.total,
        "fs_used": usage.used,
        "fs_free": usage.free,
        "by_dir": by_dir,
        "data_dir": str(data_dir),
        "modules_dir": str(modules_dir),
    }


@router.get("/diagnostics")
async def diagnostics(user: CurrentUserDep) -> dict[str, Any]:
    """Single JSON blob for the *Copy diagnostics* button. Everything a
    support thread might ask for, in one round-trip.
    """
    settings = get_settings()
    try:
        loader = get_module_loader()
        manifests = [
            {
                "id": m.id,
                "version": m.version,
                "category": m.category,
                "isolation": m.dependencies.python.isolation,
            }
            for m in loader.manifests()
        ]
    except HTTPException:
        manifests = []
    return {
        "platform_version": __version__,
        "python": sys.version,
        "system": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor(),
        },
        "settings": {
            "env": settings.env,
            "log_level": settings.log_level,
            "worker_concurrency": settings.worker_concurrency,
            "data_dir": str(settings.data_dir),
            "modules_dir": str(settings.modules_dir),
        },
        "modules": manifests,
    }
