"""Discovery — DFG, Petri nets (Alpha / Inductive), Process Tree, Heuristics Net.

Each route runs the relevant pm4py discovery algorithm against the log's
events.parquet, serialises the output to a JSON shape consumed by the
xyflow canvases on the frontend, and caches under
``data/module_results/{log_id}/discovery/{key}.json``.

A `precompute` handler subscribed to ``log.imported`` runs all five
algorithms once per import so the frontend hits cache on first paint.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any

from flows_funds.sdk import Module, ModuleContext, job, on_event, route

from .serializers import (
    serialize_dfg,
    serialize_heuristics_net,
    serialize_petri_net,
    serialize_process_tree,
)

_HEURISTICS_DEFAULTS: dict[str, float] = {
    "dependency_threshold": 0.5,
    "and_threshold": 0.65,
    "loop_two_threshold": 0.5,
}


def _heuristics_thresholds(
    config: Any,
    *,
    dependency_threshold: float | None = None,
    and_threshold: float | None = None,
    loop_two_threshold: float | None = None,
) -> dict[str, float]:
    """Resolve heuristics-net thresholds.

    Precedence: explicit query-param > module config > package default.
    """
    overrides = {
        "dependency_threshold": dependency_threshold,
        "and_threshold": and_threshold,
        "loop_two_threshold": loop_two_threshold,
    }
    out: dict[str, float] = {}
    for k, default in _HEURISTICS_DEFAULTS.items():
        explicit = overrides[k]
        if explicit is not None:
            out[k] = float(explicit)
            continue
        from_cfg = config.get(f"heuristics_{k}", None) if config is not None else None
        out[k] = float(from_cfg if from_cfg is not None else default)
    return out


def _heuristics_cache_key(thresholds: dict[str, float]) -> str:
    h = hashlib.blake2b(
        json.dumps(thresholds, sort_keys=True).encode("utf-8"),
        digest_size=4,
    ).hexdigest()
    return f"heuristics_net__{h}"


def _cache_is_fresh(ctx: ModuleContext, key: str) -> bool:
    """Return True if a cached result is newer than the events.parquet."""
    cache_root = Path(ctx.cache.dir) if hasattr(ctx.cache, "dir") else None  # type: ignore[attr-defined]
    if cache_root is None:
        return False
    candidate = cache_root / f"{key}.json"
    if not candidate.exists():
        return False
    try:
        events_path = ctx.event_log.events_path  # type: ignore[attr-defined]
    except AttributeError:
        return False
    try:
        return candidate.stat().st_mtime >= events_path.stat().st_mtime
    except FileNotFoundError:
        return False


async def _cached_or_compute(
    ctx: ModuleContext,
    key: str,
    compute: Any,
    *,
    min_version: int = 0,
) -> dict[str, Any]:
    """Return cached result if mtime-fresh AND `result["version"] >= min_version`.

    The version gate lets a callsite invalidate snapshots from before a
    serializer-shape bump without having to rename the cache key.
    """
    if _cache_is_fresh(ctx, key):
        cached = await ctx.cache.get(key)
        if cached is not None:
            cached_version = cached.get("version", 0) if isinstance(cached, dict) else 0
            if cached_version >= min_version:
                return cached
    result = await compute()
    await ctx.cache.set(key, result)
    return result


def _rename_pm4py(df: Any) -> Any:
    return df.rename(
        columns={
            "case_id": "case:concept:name",
            "activity": "concept:name",
            "timestamp": "time:timestamp",
        }
    )


def _activity_mean_trace_position(renamed: Any) -> dict[str, float]:
    """Mean normalised position (0..1) of each activity within its trace.

    For each event we compute its 0..1 position inside its case (event index
    over trace length - 1), then average per activity. Single-event traces
    contribute 0.0. The result is the frontend's "when does this activity
    tend to happen" sort key — lets the DFG canvas order within-layer nodes
    by real temporal execution rather than by frequency.
    """
    sorted_df = renamed.sort_values(
        ["case:concept:name", "time:timestamp"], kind="mergesort"
    )
    grouped = sorted_df.groupby("case:concept:name", sort=False)
    # Per-event 0-based index inside its case, and case length.
    cum_index = grouped.cumcount()
    case_size = grouped["concept:name"].transform("size")
    # Length-1 cases produce a 0/0; map them to 0.0 explicitly.
    denom = (case_size - 1).where(case_size > 1, 1)
    positions = (cum_index / denom).where(case_size > 1, 0.0)

    sums: dict[str, float] = {}
    counts: dict[str, int] = {}
    for activity, pos in zip(
        sorted_df["concept:name"].tolist(), positions.tolist(), strict=False
    ):
        if pos is None or (isinstance(pos, float) and pos != pos):
            continue
        key = str(activity)
        sums[key] = sums.get(key, 0.0) + float(pos)
        counts[key] = counts.get(key, 0) + 1
    return {k: sums[k] / counts[k] for k in sums}


def _edge_mean_durations(renamed: Any) -> dict[tuple[str, str], float]:
    """Mean transition time (in seconds) per (a, b) directly-follows pair.

    Computed by sorting events by case + timestamp, taking the in-case
    LEAD across (activity, timestamp), and grouping the resulting deltas.
    Used by the DFG view's "Edge label: Duration" mode.
    """
    sorted_df = renamed.sort_values(
        ["case:concept:name", "time:timestamp"], kind="mergesort"
    )
    grouped = sorted_df.groupby("case:concept:name", sort=False)
    next_act = grouped["concept:name"].shift(-1)
    next_ts = grouped["time:timestamp"].shift(-1)
    delta_seconds = (next_ts - sorted_df["time:timestamp"]).dt.total_seconds()

    sums: dict[tuple[str, str], float] = {}
    counts: dict[tuple[str, str], int] = {}
    for src, tgt, dur in zip(
        sorted_df["concept:name"].tolist(),
        next_act.tolist(),
        delta_seconds.tolist(),
        strict=False,
    ):
        if tgt is None or (isinstance(tgt, float) and tgt != tgt):
            continue
        if dur is None or (isinstance(dur, float) and dur != dur):
            continue
        key = (str(src), str(tgt))
        sums[key] = sums.get(key, 0.0) + float(dur)
        counts[key] = counts.get(key, 0) + 1
    return {k: sums[k] / counts[k] for k in sums}


class DiscoveryModule(Module):
    id = "discovery"

    # -- compute helpers (reusable from routes + precompute) ------------------

    async def _compute_dfg(self, ctx: ModuleContext) -> dict[str, Any]:
        async with ctx.event_log as log:
            df = await log.pandas()

        def _run() -> dict[str, Any]:
            import pm4py

            renamed = _rename_pm4py(df)
            dfg, start, end = pm4py.discover_dfg(renamed)
            durations = _edge_mean_durations(renamed)
            mean_positions = _activity_mean_trace_position(renamed)
            return serialize_dfg(
                dfg, start, end, durations=durations, mean_positions=mean_positions
            )

        return await asyncio.to_thread(_run)

    async def _compute_petri_alpha(self, ctx: ModuleContext) -> dict[str, Any]:
        async with ctx.event_log as log:
            df = await log.pandas()

        def _run() -> dict[str, Any]:
            import pm4py

            renamed = _rename_pm4py(df)
            net, im, fm = pm4py.discover_petri_net_alpha(renamed)
            return serialize_petri_net(net, im, fm)

        return await asyncio.to_thread(_run)

    async def _compute_petri_inductive(self, ctx: ModuleContext) -> dict[str, Any]:
        async with ctx.event_log as log:
            df = await log.pandas()

        def _run() -> dict[str, Any]:
            import pm4py

            renamed = _rename_pm4py(df)
            net, im, fm = pm4py.discover_petri_net_inductive(renamed)
            return serialize_petri_net(net, im, fm)

        return await asyncio.to_thread(_run)

    async def _compute_process_tree(self, ctx: ModuleContext) -> dict[str, Any]:
        async with ctx.event_log as log:
            df = await log.pandas()

        def _run() -> dict[str, Any]:
            import pm4py

            renamed = _rename_pm4py(df)
            tree = pm4py.discover_process_tree_inductive(renamed)
            return serialize_process_tree(tree)

        return await asyncio.to_thread(_run)

    async def _compute_heuristics_net(
        self,
        ctx: ModuleContext,
        *,
        dependency_threshold: float,
        and_threshold: float,
        loop_two_threshold: float,
    ) -> dict[str, Any]:
        async with ctx.event_log as log:
            df = await log.pandas()

        def _run() -> dict[str, Any]:
            import pm4py

            renamed = _rename_pm4py(df)
            hnet = pm4py.discover_heuristics_net(
                renamed,
                dependency_threshold=dependency_threshold,
                and_threshold=and_threshold,
                loop_two_threshold=loop_two_threshold,
            )
            return serialize_heuristics_net(hnet)

        return await asyncio.to_thread(_run)

    # -- routes ---------------------------------------------------------------

    @route.get("/dfg")
    async def dfg(self, ctx: ModuleContext) -> dict[str, Any]:
        # min_version=3: mean_trace_position was added in v3; force-recompute
        # older caches that don't have it (v2 added durations).
        return await _cached_or_compute(
            ctx, "dfg", lambda: self._compute_dfg(ctx), min_version=3
        )

    @route.get("/petri-net/alpha")
    async def petri_alpha(self, ctx: ModuleContext) -> dict[str, Any]:
        return await _cached_or_compute(
            ctx, "petri_net_alpha", lambda: self._compute_petri_alpha(ctx)
        )

    @route.get("/petri-net/inductive")
    async def petri_inductive(self, ctx: ModuleContext) -> dict[str, Any]:
        return await _cached_or_compute(
            ctx, "petri_net_inductive", lambda: self._compute_petri_inductive(ctx)
        )

    @route.get("/process-tree")
    async def process_tree(self, ctx: ModuleContext) -> dict[str, Any]:
        return await _cached_or_compute(
            ctx, "process_tree", lambda: self._compute_process_tree(ctx)
        )

    @route.get("/heuristics-net")
    async def heuristics_net(
        self,
        ctx: ModuleContext,
        *,
        dependency_threshold: float | None = None,
        and_threshold: float | None = None,
        loop_two_threshold: float | None = None,
    ) -> dict[str, Any]:
        thresholds = _heuristics_thresholds(
            ctx.config,
            dependency_threshold=dependency_threshold,
            and_threshold=and_threshold,
            loop_two_threshold=loop_two_threshold,
        )
        key = _heuristics_cache_key(thresholds)
        return await _cached_or_compute(
            ctx, key, lambda: self._compute_heuristics_net(ctx, **thresholds)
        )

    # -- precompute on import -------------------------------------------------

    @on_event("log.imported")
    @job(progress=True, title="Discovery — precompute")
    async def precompute(self, ctx: ModuleContext, payload: dict[str, Any]) -> None:
        thresholds = _heuristics_thresholds(ctx.config)
        stages: list[tuple[str, Any]] = [
            ("dfg", lambda: self._compute_dfg(ctx)),
            ("petri_net_alpha", lambda: self._compute_petri_alpha(ctx)),
            ("petri_net_inductive", lambda: self._compute_petri_inductive(ctx)),
            ("process_tree", lambda: self._compute_process_tree(ctx)),
            (
                _heuristics_cache_key(thresholds),
                lambda: self._compute_heuristics_net(ctx, **thresholds),
            ),
        ]

        total = len(stages)
        for i, (key, fn) in enumerate(stages):
            await ctx.progress.update(i, total=total, stage=key, message=key)
            result = await fn()
            await ctx.cache.set(key, result)
        await ctx.progress.update(total, total=total, stage="done", message="done")
