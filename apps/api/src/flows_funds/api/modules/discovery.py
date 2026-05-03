"""Filesystem discovery — `modules/*/manifest.yaml` (§5.3 step 1).

We walk one level deep so folder names are arbitrary; only the manifest's
`id` is authoritative. Two manifests declaring the same id at startup is a
hard error.

The Python entry-point discovery (installable third-party modules under
`flows_funds.modules`) is reserved for phase 9 / future work; we read the
filesystem only for v1.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import structlog

from flows_funds.sdk.errors import ModuleManifestError
from flows_funds.sdk.manifest import Manifest

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class DiscoveredModule:
    folder: Path
    manifest: Manifest

    @property
    def id(self) -> str:
        return self.manifest.id


def discover(modules_dir: Path) -> list[DiscoveredModule]:
    if not modules_dir.exists():
        return []

    discovered: list[DiscoveredModule] = []
    seen_ids: dict[str, Path] = {}

    for entry in sorted(modules_dir.iterdir()):
        if not entry.is_dir():
            continue
        if entry.name.startswith(".") or entry.name.startswith("_"):
            continue
        manifest_path = entry / "manifest.yaml"
        if not manifest_path.exists():
            log.debug("modules.discovery.no_manifest", folder=str(entry))
            continue
        try:
            manifest = Manifest.load_yaml(manifest_path)
        except ModuleManifestError as exc:
            log.error("modules.discovery.manifest_invalid", folder=str(entry), error=str(exc))
            raise
        if manifest.id in seen_ids:
            raise ModuleManifestError(
                f"Two modules declare the same id {manifest.id!r}: "
                f"{seen_ids[manifest.id]} and {entry}."
            )
        seen_ids[manifest.id] = entry
        discovered.append(DiscoveredModule(folder=entry, manifest=manifest))

    return discovered


def topo_sort(discovered: Iterable[DiscoveredModule]) -> list[DiscoveredModule]:
    """Topological sort by hard `requirements.modules`. Cycles raise."""
    by_id: dict[str, DiscoveredModule] = {d.id: d for d in discovered}
    visited: dict[str, str] = {}  # id -> "temp" | "perm"
    out: list[DiscoveredModule] = []

    def visit(node_id: str, stack: list[str]) -> None:
        if visited.get(node_id) == "perm":
            return
        if visited.get(node_id) == "temp":
            cycle = " → ".join([*stack, node_id])
            raise ModuleManifestError(f"Module dependency cycle: {cycle}")
        node = by_id.get(node_id)
        if node is None:
            raise ModuleManifestError(
                f"Module {stack[-1] if stack else '?'} requires {node_id!r}, which is not loaded."
            )
        visited[node_id] = "temp"
        for dep in node.manifest.requirements.modules:
            visit(dep, [*stack, node_id])
        visited[node_id] = "perm"
        out.append(node)

    for d in by_id.values():
        if d.id not in visited:
            visit(d.id, [])

    return out
