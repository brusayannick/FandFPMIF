"""Process complexity — EPA-based entropy, affinity, structure, Lempel-Ziv,
Pentland metrics, and temporal drift analysis.

All algorithms faithfully implement Complexity.py from WWU_processcomplexity
(Rüschel 2025). Structure score is pure Python (no SPMF needed).

Routes:
  GET /metrics      — all scalar metrics for the full log
  GET /temporal     — metrics per time window (day / week / month)
  GET /correlations — Pearson correlation matrix across time windows
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Optional

from flows_funds.sdk import Module, ModuleContext, on_event, route

from .complexity_core import (
    compute_all_metrics,
    pearson_correlation_matrix,
    split_by_window,
)


# ── Cache helpers (mirrors performance/module.py pattern) ─────────────────────

def _cache_is_fresh(ctx: ModuleContext, key: str) -> bool:
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
    ctx: ModuleContext, key: str, compute: Any
) -> dict[str, Any]:
    if _cache_is_fresh(ctx, key):
        cached = await ctx.cache.get(key)
        if cached is not None:
            return cached
    result = await compute()
    await ctx.cache.set(key, result)
    return result


# ── Config helpers ────────────────────────────────────────────────────────────

async def _get_config(ctx: ModuleContext) -> dict[str, Any]:
    try:
        cfg = await ctx.config.get()  # type: ignore[attr-defined]
        return cfg or {}
    except Exception:
        return {}


def _forgetting_k(cfg: dict[str, Any]) -> float:
    return float(cfg.get("forgetting_factor", 1.0))


def _temporal_window(cfg: dict[str, Any]) -> str:
    return str(cfg.get("temporal_window", "week"))


# ── Module ────────────────────────────────────────────────────────────────────

class ProcessComplexityModule(Module):
    id = "process_complexity"

    # ── Precompute on log import ──────────────────────────────────────────────

    @on_event("log.imported")
    async def precompute(self, ctx: ModuleContext, payload: dict[str, Any]) -> None:
        try:
            cfg = await _get_config(ctx)
            window = _temporal_window(cfg)
            k = _forgetting_k(cfg)

            async with ctx.event_log as log:
                df = await log.pandas()

            await asyncio.to_thread(self._sync_compute_all, ctx, df, k, window)
        except Exception as exc:
            ctx.logger.warning("process_complexity precompute failed", error=str(exc))

    def _sync_compute_all(
        self,
        ctx: ModuleContext,
        df: Any,
        k: float,
        window: str,
    ) -> None:
        metrics_payload = self._build_metrics_payload(df, k)
        temporal_payload = self._build_temporal_payload(df, window, k)
        corr_payload = self._build_correlations_payload(temporal_payload)

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(ctx.cache.set("metrics", metrics_payload))
            loop.run_until_complete(ctx.cache.set(f"temporal_{window}", temporal_payload))
            loop.run_until_complete(ctx.cache.set(f"correlations_{window}", corr_payload))
        finally:
            loop.close()

    # ── Routes ────────────────────────────────────────────────────────────────

    @route.get("/metrics")
    async def metrics(self, ctx: ModuleContext) -> dict[str, Any]:
        async def _compute() -> dict[str, Any]:
            cfg = await _get_config(ctx)
            async with ctx.event_log as log:
                df = await log.pandas()
            return await asyncio.to_thread(
                self._build_metrics_payload, df, _forgetting_k(cfg)
            )

        return await _cached_or_compute(ctx, "metrics", _compute)

    @route.get("/temporal")
    async def temporal(
        self, ctx: ModuleContext, window: Optional[str] = None
    ) -> dict[str, Any]:
        cfg = await _get_config(ctx)
        w = window or _temporal_window(cfg)
        cache_key = f"temporal_{w}"

        async def _compute() -> dict[str, Any]:
            async with ctx.event_log as log:
                df = await log.pandas()
            return await asyncio.to_thread(
                self._build_temporal_payload, df, w, _forgetting_k(cfg)
            )

        return await _cached_or_compute(ctx, cache_key, _compute)

    @route.get("/correlations")
    async def correlations(
        self, ctx: ModuleContext, window: Optional[str] = None
    ) -> dict[str, Any]:
        cfg = await _get_config(ctx)
        w = window or _temporal_window(cfg)
        cache_key = f"correlations_{w}"

        async def _compute() -> dict[str, Any]:
            temporal_key = f"temporal_{w}"
            temporal = await ctx.cache.get(temporal_key)
            if temporal is None:
                async with ctx.event_log as log:
                    df = await log.pandas()
                temporal = await asyncio.to_thread(
                    self._build_temporal_payload, df, w, _forgetting_k(cfg)
                )
                await ctx.cache.set(temporal_key, temporal)
            return self._build_correlations_payload(temporal)

        return await _cached_or_compute(ctx, cache_key, _compute)

    # ── Payload builders (sync — called via asyncio.to_thread) ───────────────

    def _build_metrics_payload(self, df: Any, k: float) -> dict[str, Any]:
        return {
            "kind": "complexity_metrics",
            "metrics": compute_all_metrics(df, forgetting_k=k),
        }

    def _build_temporal_payload(
        self, df: Any, window: str, k: float
    ) -> dict[str, Any]:
        windows_out = []
        for w in split_by_window(df, window):
            m = compute_all_metrics(w["df"], forgetting_k=k)
            windows_out.append(
                {
                    "label": w["label"],
                    "start": w["start"],
                    "end": w["end"],
                    "metrics": m,
                }
            )
        return {
            "kind": "complexity_temporal",
            "window": window,
            "windows": windows_out,
        }

    def _build_correlations_payload(
        self, temporal_payload: dict[str, Any]
    ) -> dict[str, Any]:
        window_metrics: list[dict[str, Any]] = [
            w["metrics"]
            for w in temporal_payload.get("windows", [])
            if w.get("metrics")
        ]
        metric_names, matrix = pearson_correlation_matrix(window_metrics)
        return {
            "kind": "complexity_correlations",
            "metrics": metric_names,
            "matrix": matrix,
        }
