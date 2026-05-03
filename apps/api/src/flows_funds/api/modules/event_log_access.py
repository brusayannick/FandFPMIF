"""EventLogAccess — lazy view of an imported log's Parquet (§5.5).

Also hosts the read-only helpers behind the Events tab: `column_specs()`
infers column types from a small parquet sample and `data_quality()`
returns null/distinct counts via DuckDB. Both run on `to_thread` so they
don't block the event loop on large logs.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import duckdb

from flows_funds.api.ingest.storage import log_paths
from flows_funds.api.schemas.event_log_data import (
    ColumnQuality,
    ColumnRole,
    ColumnSpec,
    ColumnType,
    DataQuality,
)


CANONICAL_ROLES: dict[str, ColumnRole] = {
    "case_id": "case_id",
    "activity": "activity",
    "timestamp": "timestamp",
    "end_timestamp": "end_timestamp",
    "resource": "resource",
    "cost": "cost",
    "role": "role",
    "lifecycle": "lifecycle",
}
REQUIRED_COLUMNS: frozenset[str] = frozenset({"case_id", "activity", "timestamp"})
ENUM_DETECT_THRESHOLD = 25  # cardinality below which a string column is treated as enum


class EventLogAccess:
    """Async-context-manager view of a single log.

    Construction is cheap; readers (``pandas()`` / ``polars()`` / ``pm4py()`` /
    ``duckdb_fetch``) materialise on demand and cache nothing — keeping memory
    usage explicit. polars/pm4py are best-effort: if the module didn't
    inherit them, the call raises a clear error.
    """

    def __init__(self, log_id: str) -> None:
        self.log_id = log_id
        self._paths = log_paths(log_id)
        self._conn: duckdb.DuckDBPyConnection | None = None

    async def __aenter__(self) -> "EventLogAccess":
        if not self._paths.events.exists():
            raise FileNotFoundError(
                f"Event log {self.log_id} has no events.parquet — import not finished?"
            )
        return self

    async def __aexit__(self, *exc: object) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:  # noqa: BLE001
                pass
            self._conn = None

    @property
    def events_path(self) -> Path:
        return self._paths.events

    @property
    def cases_path(self) -> Path:
        return self._paths.cases

    async def pandas(self) -> Any:
        import pandas as pd

        return await asyncio.to_thread(pd.read_parquet, self._paths.events)

    async def polars(self) -> Any:
        try:
            import polars as pl
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "polars is not available — declare it in your manifest's "
                "dependencies.python.inherit or .packages."
            ) from exc
        return await asyncio.to_thread(pl.read_parquet, self._paths.events)

    async def pm4py(self) -> Any:
        try:
            import pm4py  # noqa: F401
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "pm4py is not available — declare it in your manifest's "
                "dependencies.python.inherit or .packages."
            ) from exc

        df = await self.pandas()

        def _to_event_log() -> Any:
            import pm4py
            import pm4py.utils as pmu

            renamed = df.rename(
                columns={
                    "case_id": "case:concept:name",
                    "activity": "concept:name",
                    "timestamp": "time:timestamp",
                }
            )
            return pmu.format_dataframe(renamed)

        return await asyncio.to_thread(_to_event_log)

    async def duckdb_fetch(self, sql: str, params: list | tuple | None = None) -> list[tuple]:
        def _run() -> list[tuple]:
            self._ensure_conn()
            assert self._conn is not None
            return self._conn.execute(sql, params or []).fetchall()

        return await asyncio.to_thread(_run)

    async def duckdb_fetch_with_columns(
        self, sql: str, params: list | tuple | None = None
    ) -> tuple[list[str], list[tuple]]:
        """Like `duckdb_fetch` but also returns column names — used by the
        events route to map rows to dicts without a second metadata call.
        """

        def _run() -> tuple[list[str], list[tuple]]:
            self._ensure_conn()
            assert self._conn is not None
            cur = self._conn.execute(sql, params or [])
            cols = [d[0] for d in cur.description] if cur.description else []
            return cols, cur.fetchall()

        return await asyncio.to_thread(_run)

    def _ensure_conn(self) -> None:
        if self._conn is not None:
            return
        self._conn = duckdb.connect(":memory:")
        # DuckDB rejects parameter binding in CREATE VIEW — interpolate
        # the path. Safe: paths are derived from validated log_ids (UUIDs).
        events_path = str(self._paths.events).replace("'", "''")
        self._conn.execute(
            f"CREATE OR REPLACE VIEW events AS SELECT * FROM read_parquet('{events_path}')"
        )
        if self._paths.cases.exists():
            cases_path = str(self._paths.cases).replace("'", "''")
            self._conn.execute(
                f"CREATE OR REPLACE VIEW cases AS SELECT * FROM read_parquet('{cases_path}')"
            )

    async def column_specs(
        self, overrides: dict[str, Any] | None = None
    ) -> list[ColumnSpec]:
        """Inspect events.parquet's schema (and a small distinct sample) to
        emit `ColumnSpec`s for every column in the events table. The
        per-column override JSON from `EventLog.column_overrides` can rename
        labels and reorder columns — the editor still treats the canonical
        `name` as authoritative.
        """

        def _inspect() -> list[ColumnSpec]:
            import pandas as pd

            head = pd.read_parquet(self._paths.events).head(2000)
            specs: list[ColumnSpec] = []
            for col in head.columns:
                series = head[col]
                role: ColumnRole = CANONICAL_ROLES.get(col, "custom")
                col_type = _infer_column_type(series)
                enum_values: list[str] | None = None
                if col_type == "string":
                    distinct = series.dropna().astype(str).unique().tolist()
                    if 0 < len(distinct) <= ENUM_DETECT_THRESHOLD:
                        # Lifecycle is the only column we treat as a closed
                        # vocabulary. For other low-cardinality strings we
                        # still surface the common values for UX suggestions
                        # but accept arbitrary input.
                        enum_values = sorted(distinct)
                        if role == "lifecycle":
                            col_type = "enum"
                specs.append(
                    ColumnSpec(
                        name=col,
                        label=_label_for(col, overrides),
                        role=role,
                        type=col_type,
                        nullable=True,
                        required=col in REQUIRED_COLUMNS,
                        enum_values=enum_values,
                    )
                )
            return _apply_column_order(specs, overrides)

        return await asyncio.to_thread(_inspect)

    async def data_quality(
        self, specs: list[ColumnSpec] | None = None
    ) -> DataQuality:
        """Per-column null + distinct counts for Settings → Data quality."""
        if specs is None:
            specs = await self.column_specs()

        def _quality() -> DataQuality:
            self._ensure_conn()
            assert self._conn is not None
            (total,) = self._conn.execute("SELECT COUNT(*) FROM events").fetchone()
            cols: list[ColumnQuality] = []
            for spec in specs:
                quoted = _quote_ident(spec.name)
                null_count, distinct_count = self._conn.execute(  # type: ignore[union-attr]
                    f"SELECT COUNT_IF({quoted} IS NULL), COUNT(DISTINCT {quoted}) FROM events"
                ).fetchone()
                cols.append(
                    ColumnQuality(
                        column=spec.name,
                        label=spec.label,
                        type=spec.type,
                        role=spec.role,
                        null_count=int(null_count or 0),
                        null_pct=(float(null_count or 0) / float(total)) if total else 0.0,
                        distinct_count=int(distinct_count or 0),
                    )
                )
            return DataQuality(total_events=int(total or 0), columns=cols)

        return await asyncio.to_thread(_quality)


def _infer_column_type(series: Any) -> ColumnType:
    import pandas as pd

    dtype = series.dtype
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return "datetime"
    if pd.api.types.is_bool_dtype(dtype):
        return "boolean"
    if pd.api.types.is_numeric_dtype(dtype):
        return "number"
    if pd.api.types.is_timedelta64_dtype(dtype):
        return "duration"
    return "string"


def _label_for(name: str, overrides: dict[str, Any] | None) -> str:
    if overrides and isinstance(overrides.get("labels"), dict):
        label = overrides["labels"].get(name)
        if isinstance(label, str) and label.strip():
            return label
    return name.replace("_", " ").strip().capitalize()


def _apply_column_order(
    specs: list[ColumnSpec], overrides: dict[str, Any] | None
) -> list[ColumnSpec]:
    if not overrides:
        return specs
    order = overrides.get("order")
    if not isinstance(order, list):
        return specs
    by_name = {s.name: s for s in specs}
    ordered = [by_name.pop(name) for name in order if name in by_name]
    ordered.extend(by_name.values())
    return ordered


def _quote_ident(name: str) -> str:
    """DuckDB identifier quoting — doubles internal quotes."""
    return '"' + name.replace('"', '""') + '"'
