"""Materialise per-module Python deps via `uv venv` + `uv pip install` (§5.4).

For each discovered module:

  - If the manifest's `dependencies.python.packages` is empty *and* the
    module folder doesn't already contain a `pyproject.toml`, we skip — the
    module imports nothing beyond stdlib + inherits + SDK.
  - Otherwise we synthesise a minimal `pyproject.toml` (when the author
    didn't supply one), create an isolated venv, and install deps into it.
  - A content-hash of the dependencies block is cached at
    `modules/<folder>/.installed-hash`. Re-runs skip when the hash matches.

We use `uv venv` + `uv pip install` rather than `uv sync` to avoid writing
a lock file, which fails on macOS Docker Desktop bind mounts due to atomic-
write restrictions on the VirtioFS layer.

`subprocess` isolation is recognised but currently a no-op — the loader
warns and falls back to in_process. (See INSTRUCTIONS.md §5.4 — promoting a
module to subprocess is a future deliverable.)
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
import sys
from pathlib import Path

import structlog

from flows_funds.sdk.manifest import Manifest

log = structlog.get_logger(__name__)


def _hash_path(folder: Path) -> Path:
    return folder / ".installed-hash"


def _venv_site_packages(folder: Path) -> Path:
    """Return the site-packages path for the venv in *folder*.

    Reads the Python version from the venv's pyvenv.cfg so modules that use
    a different Python version than the platform (e.g. Python 3.9 subprocess
    venvs running alongside the platform's Python 3.12) get the correct path.
    """
    cfg = folder / ".venv" / "pyvenv.cfg"
    if cfg.exists():
        for line in cfg.read_text().splitlines():
            key, _, val = line.partition("=")
            if key.strip() == "version_info":
                major, minor, *_ = val.strip().split(".")
                return folder / ".venv" / "lib" / f"python{major}.{minor}" / "site-packages"
    pyver = f"python{sys.version_info.major}.{sys.version_info.minor}"
    return folder / ".venv" / "lib" / pyver / "site-packages"


def _synthesise_pyproject(folder: Path, manifest: Manifest) -> None:
    """Create a minimal pyproject if the author didn't supply one."""
    target = folder / "pyproject.toml"
    if target.exists():
        return
    py = manifest.dependencies.python
    requires = py.requires_python or ">=3.12"
    deps = "\n".join(f'    "{p}",' for p in py.packages)
    content = f"""[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "ff-mod-{manifest.id.replace('_', '-')}"
version = "{manifest.version}"
requires-python = "{requires}"
dependencies = [
{deps}
]

[tool.hatch.build.targets.wheel]
bypass-selection = true
"""
    target.write_text(content)


async def _run(cmd: list[str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    out, _ = await proc.communicate()
    text = out.decode("utf-8", errors="replace") if out else ""
    return proc.returncode or 0, text


async def install_module(folder: Path, manifest: Manifest, *, force: bool = False) -> Path | None:
    """Create an isolated venv and install module deps if needed.

    Returns the venv site-packages path, or None when no Python deps are
    declared or installation failed.
    """
    if manifest.dependencies.python.isolation == "subprocess":
        log.warning(
            "modules.installer.subprocess_not_implemented",
            module_id=manifest.id,
            note="Falling back to in_process. subprocess isolation lands in a future phase.",
        )

    py = manifest.dependencies.python
    if not py.packages and not (folder / "pyproject.toml").exists():
        return None

    expected = manifest.dependencies_hash()
    hash_file = _hash_path(folder)
    venv_dir = folder / ".venv"
    if not force and hash_file.exists() and hash_file.read_text().strip() == expected:
        site = _venv_site_packages(folder)
        venv_python = venv_dir / "bin" / "python3"
        if site.exists() and venv_python.exists():
            log.debug("modules.installer.skip_unchanged", module_id=manifest.id)
            return site

    _synthesise_pyproject(folder, manifest)

    requires_python = py.requires_python or ">=3.12"
    # Wipe a stale venv so `uv venv` starts clean (broken symlinks from a
    # previous container won't confuse it).
    if venv_dir.exists():
        shutil.rmtree(venv_dir, ignore_errors=True)

    log.info("modules.installer.start", module_id=manifest.id, packages=py.packages)

    # Step 1 — create the venv with the right Python version.
    rc, out = await _run(["uv", "venv", str(venv_dir), "--python", requires_python])
    if rc != 0:
        log.error("modules.installer.venv_failed", module_id=manifest.id, output=out)
        return None

    # Step 2 — install the project (and all its declared deps) into the venv.
    # `uv pip install <dir>` reads pyproject.toml and installs dependencies
    # without creating or requiring a lock file.
    rc, out = await _run(
        ["uv", "pip", "install", "--python", str(venv_dir), str(folder)]
    )
    if rc != 0:
        log.error("modules.installer.failed", module_id=manifest.id, output=out)
        return None

    hash_file.write_text(expected)
    site = _venv_site_packages(folder)
    if not site.exists():
        log.warning(
            "modules.installer.site_packages_missing",
            module_id=manifest.id,
            expected=str(site),
        )
        return None
    log.info("modules.installer.complete", module_id=manifest.id, site=str(site))
    return site


def remove_module_artifacts(folder: Path) -> None:
    """Wipe `.venv/`, `.dist/`, `.installed-hash`, `node_modules/`. The
    manifest and `module.py` are kept — only build artefacts go.
    """
    for name in (".venv", ".dist", "node_modules", ".installed-hash"):
        target = folder / name
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
        elif target.exists():
            target.unlink(missing_ok=True)
