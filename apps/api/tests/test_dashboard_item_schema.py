"""Unit tests for the DashboardItem widget/viz discriminated union.

The board's ``layout_json`` round-trips through ``DashboardItem``, so the union
must validate both card kinds, reject malformed cards, and load legacy items
(written before ``kind`` existed) as ``widget`` - the property that lets the
feature ship with no migration.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from mate.api.schemas.dashboards import DashboardItem


def test_widget_kind_requires_module_and_widget() -> None:
    item = DashboardItem(i="a", module_id="discovery", widget_id="process-map")
    assert item.kind == "widget"

    with pytest.raises(ValidationError):
        DashboardItem(i="a", kind="widget", module_id="discovery")  # no widget_id


def test_legacy_item_without_kind_loads_as_widget() -> None:
    # A row written before `kind` existed: no `kind`, carries module_id/widget_id.
    item = DashboardItem.model_validate(
        {"i": "a", "module_id": "discovery", "widget_id": "process-map", "x": 0, "y": 0, "w": 6, "h": 8}
    )
    assert item.kind == "widget"
    assert item.module_id == "discovery"


def test_viz_kind_requires_dataset_ref() -> None:
    item = DashboardItem(
        i="b",
        kind="viz",
        dataset_ref={"module_id": "discovery", "dataset_id": "dfg"},
    )
    assert item.kind == "viz"
    assert item.dataset_ref is not None
    assert item.dataset_ref.dataset_id == "dfg"
    # Unconfigured viz card is valid: viz_id/mapping fill in later.
    assert item.viz_id is None
    assert item.mapping == {}

    with pytest.raises(ValidationError):
        DashboardItem(i="b", kind="viz", viz_id="bar")  # no dataset_ref


def test_viz_kind_roundtrips_mapping_and_options() -> None:
    raw = {
        "i": "c",
        "kind": "viz",
        "dataset_ref": {"module_id": "conformance", "dataset_id": "per_activity"},
        "viz_id": "bar",
        "mapping": {"x": "activity", "y": "deviations"},
        "config": {"stacked": True},
        "x": 2,
        "y": 0,
        "w": 6,
        "h": 8,
    }
    item = DashboardItem.model_validate(raw)
    dumped = item.model_dump()
    assert dumped["kind"] == "viz"
    assert dumped["mapping"] == {"x": "activity", "y": "deviations"}
    assert dumped["config"] == {"stacked": True}
