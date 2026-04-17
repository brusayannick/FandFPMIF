from __future__ import annotations

import io
import tempfile
from collections import Counter, defaultdict, deque
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from modules.base import AbstractModule
from schemas.graph import EdgeSchema, GraphSchema, NodeData, NodeSchema, Position


class EventLogImporterConfig(BaseModel):
    noise_threshold: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description=(
            "Minimum edge frequency ratio (0–1) relative to the most frequent edge. "
            "Edges below this threshold are pruned from the DFG."
        ),
    )
    horizontal_spacing: int = Field(default=220, ge=80, le=600)
    vertical_spacing: int = Field(default=120, ge=60, le=400)
    show_frequencies: bool = Field(
        default=True,
        description="Include activity/edge frequencies in labels.",
    )


class ActivityStat(BaseModel):
    activity: str
    frequency: int


class EdgeStat(BaseModel):
    source: str
    target: str
    frequency: int


class EventLogImportResult(BaseModel):
    graph: GraphSchema
    num_cases: int
    num_events: int
    num_activities: int
    num_variants: int
    top_activities: list[ActivityStat]
    top_edges: list[EdgeStat]
    start_activities: list[str]
    end_activities: list[str]
    warnings: list[str] = Field(default_factory=list)


def _compute_layout(
    activities: list[str],
    edges: dict[tuple[str, str], int],
    start_set: set[str],
    end_set: set[str],
    config: EventLogImporterConfig,
) -> dict[str, tuple[float, float]]:
    """BFS layering from synthetic START, positions nodes left-to-right."""
    adj: dict[str, list[str]] = defaultdict(list)
    for (src, tgt) in edges:
        if src != tgt:
            adj[src].append(tgt)

    depth: dict[str, int] = {}
    queue: deque[tuple[str, int]] = deque()

    for act in start_set:
        depth[act] = 0
        queue.append((act, 0))

    while queue:
        node, d = queue.popleft()
        for nxt in adj.get(node, []):
            if nxt not in depth or depth[nxt] < d + 1:
                depth[nxt] = d + 1
                queue.append((nxt, d + 1))

    for act in activities:
        if act not in depth:
            depth[act] = max(depth.values(), default=0) + 1

    layers: dict[int, list[str]] = defaultdict(list)
    for act, d in depth.items():
        layers[d].append(act)

    positions: dict[str, tuple[float, float]] = {}
    for d, acts in sorted(layers.items()):
        for i, act in enumerate(sorted(acts)):
            x = 200 + d * config.horizontal_spacing
            y = 120 + i * config.vertical_spacing
            positions[act] = (x, y)

    max_depth = max(depth.values(), default=0)
    positions["__start__"] = (60, 120 + (len(start_set) - 1) * config.vertical_spacing / 2)
    positions["__end__"] = (
        200 + (max_depth + 1) * config.horizontal_spacing,
        120 + (len(end_set) - 1) * config.vertical_spacing / 2,
    )
    return positions


def _safe_id(raw: str, used: set[str]) -> str:
    base = "act_" + "".join(c if c.isalnum() else "_" for c in raw).strip("_").lower()
    if not base or base == "act_":
        base = "act"
    candidate = base
    i = 1
    while candidate in used:
        i += 1
        candidate = f"{base}_{i}"
    used.add(candidate)
    return candidate


def _build_graph(
    dfg: dict[tuple[str, str], int],
    start_activities: dict[str, int],
    end_activities: dict[str, int],
    activity_freq: dict[str, int],
    config: EventLogImporterConfig,
) -> tuple[GraphSchema, list[str]]:
    warnings: list[str] = []

    if config.noise_threshold > 0 and dfg:
        max_freq = max(dfg.values())
        cutoff = max_freq * config.noise_threshold
        dfg = {k: v for k, v in dfg.items() if v >= cutoff}

    activities = sorted(activity_freq.keys())
    start_set = set(start_activities.keys())
    end_set = set(end_activities.keys())

    positions = _compute_layout(activities, dfg, start_set, end_set, config)

    used_ids: set[str] = set()
    id_map: dict[str, str] = {}
    for act in activities:
        id_map[act] = _safe_id(act, used_ids)

    nodes: list[NodeSchema] = []

    sx, sy = positions["__start__"]
    nodes.append(
        NodeSchema(
            id="n_start",
            type="startEvent",
            position=Position(x=sx, y=sy),
            data=NodeData(label="Start", status="idle"),
        )
    )

    for act in activities:
        freq = activity_freq[act]
        label = f"{act} ({freq})" if config.show_frequencies else act
        x, y = positions[act]
        nodes.append(
            NodeSchema(
                id=id_map[act],
                type="task",
                position=Position(x=x, y=y),
                data=NodeData(label=label, status="idle"),
            )
        )

    ex, ey = positions["__end__"]
    nodes.append(
        NodeSchema(
            id="n_end",
            type="endEvent",
            position=Position(x=ex, y=ey),
            data=NodeData(label="End", status="idle"),
        )
    )

    edges: list[EdgeSchema] = []
    edge_counter = 0

    for act, freq in start_activities.items():
        edge_counter += 1
        edges.append(
            EdgeSchema(
                id=f"e_start_{edge_counter}",
                source="n_start",
                target=id_map[act],
                label=str(freq) if config.show_frequencies else None,
                animated=False,
            )
        )

    for (src, tgt), freq in dfg.items():
        if src not in id_map or tgt not in id_map:
            continue
        edge_counter += 1
        edges.append(
            EdgeSchema(
                id=f"e_{edge_counter}",
                source=id_map[src],
                target=id_map[tgt],
                label=str(freq) if config.show_frequencies else None,
                animated=False,
            )
        )

    for act, freq in end_activities.items():
        if act not in id_map:
            continue
        edge_counter += 1
        edges.append(
            EdgeSchema(
                id=f"e_end_{edge_counter}",
                source=id_map[act],
                target="n_end",
                label=str(freq) if config.show_frequencies else None,
                animated=False,
            )
        )

    if not activities:
        warnings.append("No activities found in the event log.")

    return GraphSchema(nodes=nodes, edges=edges), warnings


def _read_event_log(
    file_bytes: bytes,
    filename: str,
    case_id_col: str | None,
    activity_col: str | None,
    timestamp_col: str | None,
):
    import pandas as pd
    import pm4py

    lower = filename.lower()
    suffix = Path(filename).suffix.lower()

    with tempfile.NamedTemporaryFile(suffix=suffix or ".tmp", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        if lower.endswith(".xes") or lower.endswith(".xes.gz"):
            log = pm4py.read_xes(tmp_path)
            return log

        if lower.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(file_bytes))
            if not case_id_col or not activity_col or not timestamp_col:
                raise ValueError(
                    "CSV uploads require case_id_column, activity_column, and timestamp_column."
                )
            for col in (case_id_col, activity_col, timestamp_col):
                if col not in df.columns:
                    raise ValueError(
                        f"Column {col!r} not found in CSV. Available: {list(df.columns)}"
                    )
            df = pm4py.format_dataframe(
                df,
                case_id=case_id_col,
                activity_key=activity_col,
                timestamp_key=timestamp_col,
            )
            return df

        raise ValueError(
            f"Unsupported file extension for {filename}. "
            "Use .xes, .xes.gz, or .csv."
        )
    finally:
        try:
            Path(tmp_path).unlink()
        except OSError:
            pass


def _compute_stats(log, config: EventLogImporterConfig) -> EventLogImportResult:
    import pm4py

    dfg, start_activities, end_activities = pm4py.discover_dfg(log)

    try:
        variants = pm4py.get_variants(log)
        num_variants = len(variants)
    except Exception:
        num_variants = 0

    activity_freq: dict[str, int] = {}
    try:
        acts = pm4py.get_event_attribute_values(log, "concept:name")
        activity_freq = {str(k): int(v) for k, v in acts.items()}
    except Exception:
        for (s, _), f in dfg.items():
            activity_freq[s] = activity_freq.get(s, 0) + int(f)
        for act, f in start_activities.items():
            activity_freq[act] = activity_freq.get(act, 0) + int(f)

    num_events = sum(activity_freq.values())
    num_cases = sum(int(v) for v in start_activities.values())

    graph, warnings = _build_graph(
        {k: int(v) for k, v in dfg.items()},
        {k: int(v) for k, v in start_activities.items()},
        {k: int(v) for k, v in end_activities.items()},
        activity_freq,
        config,
    )

    top_activities = [
        ActivityStat(activity=a, frequency=f)
        for a, f in Counter(activity_freq).most_common(10)
    ]
    top_edges = [
        EdgeStat(source=s, target=t, frequency=int(f))
        for (s, t), f in sorted(dfg.items(), key=lambda kv: kv[1], reverse=True)[:10]
    ]

    return EventLogImportResult(
        graph=graph,
        num_cases=int(num_cases),
        num_events=int(num_events),
        num_activities=len(activity_freq),
        num_variants=int(num_variants),
        top_activities=top_activities,
        top_edges=top_edges,
        start_activities=sorted(start_activities.keys()),
        end_activities=sorted(end_activities.keys()),
        warnings=warnings,
    )


class EventLogImporterModule(AbstractModule):
    module_id = "event_log_importer"
    display_name = "Event Log Importer"
    version = "1.0.0"
    description = (
        "Uploads XES or CSV event logs, analyses them with pm4py, and generates "
        "a Directly-Follows Graph with activity and transition frequencies."
    )

    def get_config_schema(self) -> type[BaseModel]:
        return EventLogImporterConfig

    def get_router(self) -> APIRouter:
        router = APIRouter()

        @router.post("/import", response_model=EventLogImportResult)
        async def import_event_log(
            file: UploadFile = File(...),
            case_id_column: str | None = Form(default=None),
            activity_column: str | None = Form(default=None),
            timestamp_column: str | None = Form(default=None),
            noise_threshold: float = Form(default=0.0),
            show_frequencies: bool = Form(default=True),
        ) -> EventLogImportResult:
            if file.size is not None and file.size > 100_000_000:
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    "Event log files larger than 100 MB are not supported.",
                )
            contents = await file.read()

            config = EventLogImporterConfig(
                noise_threshold=noise_threshold,
                show_frequencies=show_frequencies,
            )

            try:
                log = _read_event_log(
                    contents,
                    file.filename or "upload",
                    case_id_column,
                    activity_column,
                    timestamp_column,
                )
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
            except ImportError as exc:
                raise HTTPException(
                    status.HTTP_503_SERVICE_UNAVAILABLE,
                    f"pm4py not available: {exc}",
                )
            except Exception as exc:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"Failed to read event log: {exc}",
                )

            try:
                return _compute_stats(log, config)
            except Exception as exc:
                raise HTTPException(
                    status.HTTP_500_INTERNAL_SERVER_ERROR,
                    f"Failed to analyse event log: {exc}",
                )

        @router.get("/config", response_model=EventLogImporterConfig)
        async def get_config() -> EventLogImporterConfig:
            return EventLogImporterConfig()

        return router
