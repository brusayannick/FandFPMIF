"""On-disk layout for an imported event log (INSTRUCTIONS.md §3.2).

    data/event_logs/{log_id}/
    ├── meta.json          # source format, ingest stats, detected schema, mapping
    ├── events.parquet     # flat event table, sorted by (case_id, timestamp)
    ├── cases.parquet      # cached case-level aggregates
    ├── original.{ext}     # original upload (audit / re-export)
    └── ocel/              # reserved for OCEL extension
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from flows_funds.api.config import get_settings


@dataclass(frozen=True)
class LogPaths:
    root: Path
    meta: Path
    events: Path
    cases: Path
    ocel_dir: Path

    def exists(self) -> bool:
        return self.root.exists()

    def original_for(self, ext: str) -> Path:
        ext = ext.lstrip(".")
        return self.root / f"original.{ext}"

    def ensure(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.ocel_dir.mkdir(parents=True, exist_ok=True)

    def write_meta(self, meta: dict[str, Any]) -> None:
        self.meta.write_text(json.dumps(meta, indent=2, default=str))

    def read_meta(self) -> dict[str, Any] | None:
        if not self.meta.exists():
            return None
        return json.loads(self.meta.read_text())

    def remove(self) -> None:
        if self.root.exists():
            shutil.rmtree(self.root)


def log_paths(log_id: str) -> LogPaths:
    root = get_settings().event_logs_dir / log_id
    return LogPaths(
        root=root,
        meta=root / "meta.json",
        events=root / "events.parquet",
        cases=root / "cases.parquet",
        ocel_dir=root / "ocel",
    )
