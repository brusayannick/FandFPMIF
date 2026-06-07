"""OC-DFG serializer test — builds a small OCEL, discovers the OC-DFG with
pm4py, and asserts the flattened shape the widgets consume."""

from __future__ import annotations

import pandas as pd
import pm4py
from modules.ocel_discovery.module import _serialize_ocdfg
from pm4py.objects.ocel.obj import OCEL


def _sample_ocel() -> OCEL:
    events = pd.DataFrame(
        {
            "ocel:eid": ["e1", "e2", "e3"],
            "ocel:activity": ["create order", "pay", "ship"],
            "ocel:timestamp": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"], utc=True),
        }
    )
    relations = pd.DataFrame(
        {
            "ocel:eid": ["e1", "e2", "e3"],
            "ocel:activity": ["create order", "pay", "ship"],
            "ocel:timestamp": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"], utc=True),
            "ocel:oid": ["o1", "o1", "o1"],
            "ocel:type": ["order", "order", "order"],
            "ocel:qualifier": ["", "", ""],
        }
    )
    objects = pd.DataFrame({"ocel:oid": ["o1"], "ocel:type": ["order"]})
    return OCEL(events=events, objects=objects, relations=relations)


def test_serialize_ocdfg_shape() -> None:
    ocdfg = pm4py.discover_ocdfg(_sample_ocel())
    out = _serialize_ocdfg(ocdfg)

    assert out["object_types"] == ["order"]
    assert set(out["activities"]) == {"create order", "pay", "ship"}
    # create order → pay → ship for the single order object.
    edge_pairs = {(e["source"], e["target"]) for e in out["edges"]}
    assert ("create order", "pay") in edge_pairs
    assert ("pay", "ship") in edge_pairs
    assert all(e["object_type"] == "order" for e in out["edges"])
    assert all(e["count"] >= 1 for e in out["edges"])
    assert any(a["activity"] == "create order" for a in out["start_activities"])
    assert any(a["activity"] == "ship" for a in out["end_activities"])
