"""Module install pipeline (§7.6.2 Importing a new module).

The route ``POST /api/v1/modules/install`` accepts either:

  - a multipart upload (``file`` field) of a ``.zip`` / ``.tar.gz`` containing
    a module folder with ``manifest.yaml`` at the top level, or
  - a JSON body of ``{"git_url": "...", "ref": "main"}`` cloned via git.

It enqueues a Job (so progress streams over the existing WS), stages into a
tmp dir, validates the manifest, moves into ``modules/<id>/``, runs
``uv sync`` for the new module, mounts it via the loader, and emits
``module.installed`` on the bus.

The PyPI/npm method noted in §7.6.2 is reserved for the entry-point
discovery path and is not implemented in this phase.
"""

from __future__ import annotations

import asyncio
import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import structlog

from flows_funds.api.config import get_settings
from flows_funds.api.jobs.runtime import JobHandle, JobRuntime
from flows_funds.api.modules.installer import install_module, remove_module_artifacts
from flows_funds.sdk.errors import ModuleManifestError
from flows_funds.sdk.manifest import Manifest

log = structlog.get_logger(__name__)

INSTALL_JOB_TYPE = "module.install"


def _is_archive(path: Path) -> str | None:
    n = path.name.lower()
    if n.endswith(".zip"):
        return "zip"
    if n.endswith(".tar.gz") or n.endswith(".tgz"):
        return "tar"
    return None


def _unpack(archive: Path, dest: Path) -> None:
    """Unpack `archive` into `dest`. Refuses path traversal."""
    kind = _is_archive(archive)
    if kind == "zip":
        with zipfile.ZipFile(archive) as zf:
            for member in zf.infolist():
                target = dest / member.filename
                if not str(target.resolve()).startswith(str(dest.resolve())):
                    raise ValueError(f"Archive path escapes target dir: {member.filename}")
            zf.extractall(dest)
    elif kind == "tar":
        with tarfile.open(archive, "r:gz") as tf:
            for member in tf.getmembers():
                target = dest / member.name
                if not str(target.resolve()).startswith(str(dest.resolve())):
                    raise ValueError(f"Archive path escapes target dir: {member.name}")
            tf.extractall(dest)
    else:
        raise ValueError(f"Unsupported archive format: {archive.name}")


def _find_manifest(root: Path) -> Path | None:
    """Some archives include the folder; some don't. Look one level deep."""
    direct = root / "manifest.yaml"
    if direct.exists():
        return direct
    for child in root.iterdir():
        if child.is_dir() and (child / "manifest.yaml").exists():
            return child / "manifest.yaml"
    return None


async def _git_clone(url: str, ref: str | None, dest: Path) -> None:
    args = ["git", "clone", "--depth", "1"]
    if ref:
        args += ["--branch", ref]
    args += [url, str(dest)]
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    out, _ = await proc.communicate()
    if proc.returncode != 0:
        text = out.decode("utf-8", errors="replace") if out else ""
        raise RuntimeError(f"git clone failed: {text.strip()}")
    # Drop .git so the module folder is self-contained.
    git_dir = dest / ".git"
    if git_dir.exists():
        shutil.rmtree(git_dir, ignore_errors=True)


async def install_handler(handle: JobHandle) -> None:
    """The job runtime's handler for `module.install` jobs."""
    payload: dict[str, Any] = handle.payload
    method: str = payload["method"]  # "archive" | "git"
    settings = get_settings()
    modules_dir = settings.modules_dir.resolve()
    modules_dir.mkdir(parents=True, exist_ok=True)

    await handle.progress(0, total=5, stage="staging", message="Preparing", force=True)

    with tempfile.TemporaryDirectory(prefix="ff-mod-install-") as staging:
        staging_dir = Path(staging)

        if method == "archive":
            archive_path = Path(payload["archive_path"])
            await handle.progress(1, total=5, stage="unpacking", message="Unpacking archive", force=True)
            await asyncio.to_thread(_unpack, archive_path, staging_dir)
        elif method == "git":
            url = payload["git_url"]
            ref = payload.get("ref")
            await handle.progress(1, total=5, stage="cloning", message=f"git clone {url}", force=True)
            await _git_clone(url, ref, staging_dir / "repo")
        else:
            raise ValueError(f"Unknown install method: {method!r}")

        manifest_path = await asyncio.to_thread(_find_manifest, staging_dir)
        if manifest_path is None:
            raise ValueError("Archive does not contain a manifest.yaml at the top level.")

        await handle.progress(2, total=5, stage="validating", message="Validating manifest", force=True)
        try:
            manifest = Manifest.load_yaml(manifest_path)
        except ModuleManifestError as exc:
            raise RuntimeError(f"Manifest invalid: {exc}") from exc

        # Move the contents (the directory containing manifest.yaml) into
        # modules/<id>/, refusing to overwrite an existing module.
        source_root = manifest_path.parent
        target = modules_dir / manifest.id
        if target.exists():
            raise RuntimeError(
                f"Module {manifest.id!r} is already installed. Uninstall it first."
            )
        await asyncio.to_thread(shutil.copytree, source_root, target)

        await handle.progress(3, total=5, stage="uv_sync", message="Resolving Python deps", force=True)
        try:
            await install_module(target, manifest)
        except Exception:  # noqa: BLE001
            shutil.rmtree(target, ignore_errors=True)
            raise

        await handle.progress(4, total=5, stage="mounting", message="Mounting module", force=True)
        from flows_funds.api.modules.loader import ModuleLoader, get_module_loader  # noqa: WPS433 — circular at import time

        loader: ModuleLoader = get_module_loader()
        await loader.load_one(target, manifest)

        await handle.bus.publish("module.installed", {"id": manifest.id, "version": manifest.version})
        await handle.progress(5, total=5, stage="done", message="Module ready", force=True)


def register_install_handler(runtime: JobRuntime) -> None:
    if INSTALL_JOB_TYPE not in runtime._handlers:  # type: ignore[attr-defined]
        runtime.register(INSTALL_JOB_TYPE, install_handler)


async def uninstall_module(module_id: str) -> bool:
    """Remove a module folder and its build artefacts, then unload it from the loader."""
    settings = get_settings()
    modules_dir = settings.modules_dir.resolve()
    target = modules_dir / module_id
    if not target.exists():
        return False
    from flows_funds.api.modules.loader import get_module_loader  # noqa: WPS433

    loader = get_module_loader()
    await loader.unload_one(module_id)
    remove_module_artifacts(target)
    shutil.rmtree(target, ignore_errors=True)
    await loader.bus.publish("module.uninstalled", {"id": module_id})
    return True
