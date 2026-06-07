"""Object-Centric Discovery — OC-DFG + object-type summary for OCEL logs.

Proves the object-centric module path end-to-end: every handler reads through
``ctx.object_log`` (the OCEL access layer), never ``ctx.event_log``. The module
is gated to ``log_model: object_centric`` in its manifest, so it is only ever
available on OCEL logs.
"""

from __future__ import annotations

import asyncio
from typing import Any

from mate.sdk import Module, ModuleContext, route


def _serialize_ocdfg(ocdfg: dict[str, Any]) -> dict[str, Any]:
    """Flatten pm4py's nested OC-DFG into a frontend-friendly shape.

    pm4py returns counts as ``{measure: {object_type: {key: [members...]}}}``;
    we collapse to per-object-type edge / start / end lists with unique-object
    counts.
    """
    activities = sorted(str(a) for a in ocdfg.get("activities", []))
    object_types = sorted(str(t) for t in ocdfg.get("object_types", []))

    unique_edges = ocdfg.get("edges", {}).get("unique_objects", {})
    edges: list[dict[str, Any]] = []
    for ot, couples in unique_edges.items():
        for (src, tgt), members in couples.items():
            edges.append(
                {
                    "object_type": str(ot),
                    "source": str(src),
                    "target": str(tgt),
                    "count": len(members),
                }
            )
    edges.sort(key=lambda e: (e["object_type"], -e["count"], e["source"], e["target"]))

    def _act_list(section: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        by_ot = ocdfg.get(section, {}).get("unique_objects", {})
        for ot, acts in by_ot.items():
            for act, members in acts.items():
                out.append(
                    {"object_type": str(ot), "activity": str(act), "count": len(members)}
                )
        out.sort(key=lambda e: (e["object_type"], -e["count"]))
        return out

    return {
        "activities": activities,
        "object_types": object_types,
        "edges": edges,
        "start_activities": _act_list("start_activities"),
        "end_activities": _act_list("end_activities"),
    }


class OcelDiscoveryModule(Module):
    id = "ocel_discovery"

    @route.get("/summary")
    async def summary(self, ctx: ModuleContext) -> dict[str, Any]:
        if ctx.object_log is None:
            raise RuntimeError("ocel_discovery requires an object-centric log.")
        async with ctx.object_log as ol:
            type_rows = await ol.duckdb_fetch(
                'SELECT "ocel:type" AS t, COUNT(*) AS n FROM ocel_objects '
                'GROUP BY "ocel:type" ORDER BY n DESC'
            )
            (events_count,) = (await ol.duckdb_fetch("SELECT COUNT(*) FROM ocel_events"))[0]
            (activities_count,) = (
                await ol.duckdb_fetch('SELECT COUNT(DISTINCT "ocel:activity") FROM ocel_events')
            )[0]
        return {
            "object_types": [{"type": str(t), "count": int(n)} for t, n in type_rows],
            "objects_count": int(sum(int(n) for _, n in type_rows)),
            "events_count": int(events_count),
            "activities_count": int(activities_count),
        }

    @route.get("/ocdfg")
    async def ocdfg(self, ctx: ModuleContext) -> dict[str, Any]:
        if ctx.object_log is None:
            raise RuntimeError("ocel_discovery requires an object-centric log.")
        async with ctx.object_log as ol:
            ocel = await ol.ocel()

        def _run() -> dict[str, Any]:
            import pm4py

            return _serialize_ocdfg(pm4py.discover_ocdfg(ocel))

        return await asyncio.to_thread(_run)
