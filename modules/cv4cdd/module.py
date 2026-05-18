"""CV4CDD — Computer-vision based concept-drift detection.

Wraps the WINSIM pipeline from Kraus & van der Aa (BPM'24) so the platform
can run it against any imported event log. The heavy work (similarity
matrix + TF inference) is wrapped in a ``@job`` so the user gets a
progress toast / dock entry while it runs.

The same job also auto-fires on ``log.imported`` so a freshly-imported
log is analysed without any extra click.

Routes:
  POST /detect        — kick off the detection (returns ``{"job_id": "..."}``)
  GET  /results       — fetch the cached detections JSON
  GET  /image         — fetch the overlay PNG (used by the panel <img>)
  GET  /similarity    — fetch the raw similarity-matrix PNG (no overlay)
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from fastapi.responses import Response

from flows_funds.sdk import Module, ModuleContext, job, on_event, route

# Pretrained model bundled alongside the module. Override with the
# CV4CDD_MODEL_DIR env var if you ship a different snapshot.
MODEL_DIR = Path(__file__).parent / "model" / "20240922-233643_winsim_sgd_model_4d_v1"


class Cv4cddModule(Module):
    id = "cv4cdd"

    # ── Triggers ──────────────────────────────────────────────────────────────

    @on_event("log.imported")
    @job(progress=True, title="CV4CDD — auto-detecting drifts")
    async def on_log_imported(
        self, ctx: ModuleContext, payload: dict[str, Any]
    ) -> dict[str, Any]:
        """Auto-run detection right after a log finishes importing.

        The loader stacks this as a job so the user sees a progress toast
        and can cancel it from the dock if it's not wanted.
        """
        return await self._do_detect(ctx)

    @route.post("/detect")
    @job(progress=True, title="CV4CDD — concept-drift detection")
    async def detect(self, ctx: ModuleContext) -> dict[str, Any]:
        return await self._do_detect(ctx)

    # ── Core ─────────────────────────────────────────────────────────────────

    async def _do_detect(self, ctx: ModuleContext) -> dict[str, Any]:
        if not MODEL_DIR.exists():
            raise HTTPException(
                status_code=500,
                detail=(
                    f"CV4CDD model not found at {MODEL_DIR}. Place the pretrained "
                    "saved_model under modules/cv4cdd/model/."
                ),
            )

        cfg = ctx.config.value or {}
        n_windows = int(cfg.get("n_windows", 200))
        threshold = float(cfg.get("confidence_threshold", 0.5))

        await ctx.progress.update(0.0, "Loading event log")
        df = await self._load_sorted_df(ctx)

        # Capture the running loop here on the main thread so the worker
        # thread can marshal progress callbacks back through it — calling
        # `asyncio.get_event_loop()` from inside `to_thread` raises since
        # the thread-pool thread doesn't own a loop.
        loop = asyncio.get_running_loop()

        result = await asyncio.to_thread(
            self._run_sync, df, n_windows, threshold, ctx, loop
        )

        await ctx.progress.update(0.97, "Saving results")
        await ctx.cache.set(
            "detections",
            {
                "kind": "cv4cdd_detections",
                "drifts": result["drifts"],
                "n_windows": result["n_windows"],
                "confidence_threshold": threshold,
            },
        )
        await ctx.cache.set("overlay", result["overlay_png"])
        await ctx.cache.set("similarity", result["similarity_png"])

        await ctx.progress.update(1.0, "Done")
        return {
            "kind": "cv4cdd_detections",
            "drifts": result["drifts"],
            "n_windows": result["n_windows"],
        }

    async def _load_sorted_df(self, ctx: ModuleContext) -> Any:
        """Return a DataFrame sorted so that traces appear in pm4py TIMESTAMP_SORT
        order — exactly matching the reference pipeline.

        The platform stores events.parquet sorted by (case_id, timestamp), which
        gives alphabetical trace ordering for same-timestamp ties.  The reference
        uses pm4py's XES importer with TIMESTAMP_SORT=True, which preserves the
        original XES file order for ties.  For logs with many traces starting at
        the same placeholder timestamp (e.g. midnight) this produces different
        window assignments.

        When the original XES file is still on disk we re-import it via pm4py to
        recover the exact ordering.  For CSV logs (no XES file) we fall back to
        the Parquet and sort by (start_timestamp, case_id) — consistent and
        reproducible, though it may differ from the reference for tied timestamps.
        """
        async with ctx.event_log as log:
            # events_path is public; derive the log root from it.
            log_root = log.events_path.parent
            meta_path = log_root / "meta.json"

            source_format: str = ""
            if meta_path.exists():
                try:
                    source_format = json.loads(meta_path.read_text()).get(
                        "source_format", ""
                    )
                except Exception:
                    pass

            # Try to load via pm4py when the original XES file is present.
            for ext in ([source_format] if source_format else []) + ["xes", "xes.gz"]:
                original = log_root / f"original.{ext}"
                if original.exists() and ext in {"xes", "xes.gz"}:
                    return await asyncio.to_thread(self._load_xes_df, original)

            # Fallback: read Parquet and apply a deterministic trace sort.
            df = await log.pandas()

        # Sort events by timestamp (mergesort keeps Parquet row order for ties,
        # which is alphabetical case_id — reproducible even if not identical to
        # the reference's XES file order).
        return df.sort_values("timestamp", kind="mergesort").reset_index(drop=True)

    @staticmethod
    def _load_xes_df(xes_path: Path) -> Any:
        """Load an XES file via pm4py with TIMESTAMP_SORT=True.

        This replicates the reference pipeline's import step exactly, giving
        the same trace order as the standalone cv4cdd tool.
        """
        import pandas as pd
        from pm4py.objects.log.importer.xes import importer as xes_importer
        from pm4py.objects.conversion.log import converter as log_converter
        from pm4py.objects.log.util import dataframe_utils
        from pm4py.algo.filtering.log.attributes import attributes_filter

        variant = xes_importer.Variants.ITERPARSE
        parameters = {
            variant.value.Parameters.TIMESTAMP_SORT: True,
            variant.value.Parameters.SHOW_PROGRESS_BAR: False,
        }
        event_log = xes_importer.apply(
            str(xes_path), variant=variant, parameters=parameters
        )

        # Mirror the reference's filter_complete_events (no-op when the log
        # has no lifecycle:transition attribute).
        try:
            event_log = attributes_filter.apply_events(
                event_log,
                ["complete", "COMPLETE"],
                parameters={
                    attributes_filter.Parameters.ATTRIBUTE_KEY: "lifecycle:transition",
                    attributes_filter.Parameters.POSITIVE: True,
                },
            )
        except Exception:
            pass

        df = log_converter.apply(event_log, variant=log_converter.Variants.TO_DATA_FRAME)
        df = dataframe_utils.convert_timestamp_columns_in_df(df, timest_format="ISO8601")

        return df.rename(
            columns={
                "case:concept:name": "case_id",
                "concept:name": "activity",
                "time:timestamp": "timestamp",
            }
        )[["case_id", "activity", "timestamp"]].copy()

    def _run_sync(
        self,
        df: Any,
        n_windows: int,
        threshold: float,
        ctx: ModuleContext,
        loop: asyncio.AbstractEventLoop,
    ) -> dict[str, Any]:
        from . import cv4cdd_core

        def progress(fraction: float, message: str) -> None:
            # Fire-and-forget on the main loop; we don't await so the worker
            # thread isn't blocked on the WebSocket write.
            try:
                asyncio.run_coroutine_threadsafe(
                    ctx.progress.update(fraction, message), loop
                )
            except RuntimeError:
                # Loop is closed (shutdown in progress) — drop the update.
                pass

        return cv4cdd_core.run_detection(
            df=df,
            model_path=MODEL_DIR,
            n_windows=n_windows,
            threshold=threshold,
            progress=progress,
        )

    # ── Read-only routes ─────────────────────────────────────────────────────

    @route.get("/results")
    async def results(self, ctx: ModuleContext) -> dict[str, Any]:
        cached = await ctx.cache.get("detections")
        if cached is None:
            return {
                "kind": "cv4cdd_detections",
                "drifts": [],
                "n_windows": 0,
                "ran": False,
            }
        return {**cached, "ran": True}

    @route.get("/image")
    async def image(self, ctx: ModuleContext) -> Response:
        png = await ctx.cache.get("overlay")
        if png is None:
            raise HTTPException(
                status_code=404,
                detail="No detection has been run yet. POST /detect first.",
            )
        return Response(content=png, media_type="image/png")

    @route.get("/similarity")
    async def similarity(self, ctx: ModuleContext) -> Response:
        png = await ctx.cache.get("similarity")
        if png is None:
            raise HTTPException(
                status_code=404,
                detail="No detection has been run yet.",
            )
        return Response(content=png, media_type="image/png")
