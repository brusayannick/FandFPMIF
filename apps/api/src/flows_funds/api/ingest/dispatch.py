"""Format detection + the import job handler.

The handler is registered against the `JobRuntime` at app startup. Its payload
shape (set by the route in `routes/event_logs.py`) is::

    {
        "log_id":        str,            # destination directory + DB row id
        "source_format": str,
        "original_path": str,            # the staged upload at data/event_logs/<id>/original.<ext>
        "csv_mapping":   dict | None,    # serialised CsvColumnMapping
    }

On success the row in `process_logs` is updated to status='ready' and
`events.parquet` / `cases.parquet` / `meta.json` are written. On failure the
status is flipped to 'failed' with `error` set.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd
import structlog
from sqlalchemy import update

from flows_funds.api.db.models import EventLog
from flows_funds.api.ingest.aggregation import compute_cases
from flows_funds.api.ingest.csv_parser import parse_csv
from flows_funds.api.ingest.storage import log_paths
from flows_funds.api.ingest.xes import parse_xes
from flows_funds.api.jobs.runtime import JobHandle, JobRuntime
from flows_funds.api.schemas.event_logs import CsvColumnMapping

log = structlog.get_logger(__name__)

IMPORT_JOB_TYPE = "event_log.import"


def detect_format(filename: str) -> str:
    """Map a filename to one of the canonical source formats."""
    lower = filename.lower()
    if lower.endswith(".xes.gz"):
        return "xes.gz"
    if lower.endswith(".xes"):
        return "xes"
    if lower.endswith(".csv"):
        return "csv"
    if lower.endswith(".xml"):
        return "xml"
    if lower.endswith(".jsonocel") or lower.endswith(".xmlocel"):
        return "ocel"
    raise ValueError(f"Unsupported file extension: {filename!r}")


class IngestStats(dict[str, Any]):
    pass


async def _import_handler(handle: JobHandle) -> None:
    payload = handle.payload
    log_id: str = payload["log_id"]
    source_format: str = payload["source_format"]
    original_path = Path(payload["original_path"])
    csv_mapping_data: dict[str, Any] | None = payload.get("csv_mapping")

    paths = log_paths(log_id)
    paths.ensure()

    log.info(
        "ingest.start",
        log_id=log_id,
        source_format=source_format,
        path=str(original_path),
    )

    await handle.progress(0, total=None, stage="parsing", message="Reading source file", force=True)

    if source_format in {"xes", "xes.gz"}:
        rows, detected = await asyncio.to_thread(
            parse_xes,
            original_path,
            on_progress=lambda n: None,
        )
        effective_mapping: dict[str, Any] | None = None
    elif source_format == "csv":
        mapping = CsvColumnMapping.model_validate(csv_mapping_data) if csv_mapping_data else None
        rows, detected, used = await asyncio.to_thread(parse_csv, original_path, mapping)
        effective_mapping = used.model_dump()
    else:
        raise ValueError(f"Source format {source_format!r} is not supported in v1.")

    total_events = len(rows)
    await handle.progress(
        total_events,
        total=total_events,
        stage="normalizing",
        message="Normalising events",
        force=True,
    )

    df = pd.DataFrame(rows)
    if df.empty:
        raise ValueError("Source file contained zero events.")
    if "case_id" not in df.columns:
        raise ValueError("No case_id column was detected — supply a CSV mapping or a XES log.")
    if "activity" not in df.columns:
        raise ValueError("No activity column was detected.")
    if "timestamp" not in df.columns:
        raise ValueError("No timestamp column was detected.")

    df["case_id"] = df["case_id"].astype(str)
    df["activity"] = df["activity"].astype(str)
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=False)
    df = df.dropna(subset=["timestamp"])
    df = df.sort_values(["case_id", "timestamp"], kind="mergesort").reset_index(drop=True)

    await handle.progress(
        total_events,
        total=total_events,
        stage="writing",
        message="Writing events.parquet",
        force=True,
    )

    df.to_parquet(paths.events, index=False, engine="pyarrow", compression="zstd")

    cases_df = compute_cases(df)
    cases_df.to_parquet(paths.cases, index=False, engine="pyarrow", compression="zstd")

    detected_schema = {
        **detected,
        "columns": list(df.columns),
        "row_count": int(len(df)),
    }

    meta = {
        "log_id": log_id,
        "source_format": source_format,
        "source_filename": original_path.name,
        "imported_at": datetime.now(UTC).isoformat(),
        "ocel_flag": False,
        "events_count": int(len(df)),
        "cases_count": int(cases_df.shape[0]),
        "variants_count": int(cases_df["variant_id"].nunique()),
        "date_min": _to_iso(df["timestamp"].min()),
        "date_max": _to_iso(df["timestamp"].max()),
        "detected_schema": detected_schema,
        "mapping": effective_mapping,
    }
    paths.write_meta(meta)

    async with handle.sessionmaker() as session:
        await session.execute(
            update(EventLog)
            .where(EventLog.id == log_id)
            .values(
                status="ready",
                events_count=meta["events_count"],
                cases_count=meta["cases_count"],
                variants_count=meta["variants_count"],
                date_min=df["timestamp"].min().to_pydatetime() if pd.notna(df["timestamp"].min()) else None,
                date_max=df["timestamp"].max().to_pydatetime() if pd.notna(df["timestamp"].max()) else None,
                detected_schema=detected_schema,
                imported_at=datetime.now(UTC).replace(tzinfo=None),
                error=None,
            )
        )
        await session.commit()

    await handle.progress(
        total_events,
        total=total_events,
        stage="done",
        message="Import complete",
        force=True,
    )
    log.info(
        "ingest.complete",
        log_id=log_id,
        events=meta["events_count"],
        cases=meta["cases_count"],
    )

    await handle.bus.publish(
        "log.imported",
        {
            "log_id": log_id,
            "events_count": meta["events_count"],
            "cases_count": meta["cases_count"],
            "detected_schema": detected_schema,
        },
    )


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        return value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def register_import_handler(runtime: JobRuntime) -> None:
    runtime.register(IMPORT_JOB_TYPE, _import_handler)


__all__ = [
    "IMPORT_JOB_TYPE",
    "IngestStats",
    "detect_format",
    "register_import_handler",
]
