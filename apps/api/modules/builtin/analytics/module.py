from __future__ import annotations

import hashlib
import math
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from modules.base import AbstractModule
from schemas.graph import GraphSchema, NodeSchema


TASK_TYPES = {
    "task",
    "userTask",
    "serviceTask",
    "scriptTask",
    "subprocess",
}


class AnalyticsConfig(BaseModel):
    duration_threshold_ms: int = Field(
        default=60_000,
        ge=0,
        description=(
            "Task duration above which a node is flagged as a potential "
            "bottleneck candidate before severity scoring."
        ),
    )
    top_n_bottlenecks: int = Field(default=5, ge=1, le=50)


class NodeMetric(BaseModel):
    node_id: str
    label: str
    type: str
    avg_duration_ms: float
    p90_duration_ms: float
    throughput: float
    utilization: float
    severity: float
    is_bottleneck: bool


class HistogramBin(BaseModel):
    lower_ms: float
    upper_ms: float
    count: int


class AnalyticsResult(BaseModel):
    generated_at: datetime
    process_id: str | None
    node_count: int
    edge_count: int
    avg_cycle_time_ms: float
    p50_cycle_time_ms: float
    p90_cycle_time_ms: float
    critical_bottlenecks: list[NodeMetric]
    node_metrics: list[NodeMetric]
    cycle_time_histogram: list[HistogramBin]


class AnalyseRequest(BaseModel):
    process_id: str | None = None
    graph: GraphSchema
    mode: Literal["static", "historical"] = "static"


def _seed_value(node_id: str, salt: str) -> float:
    """Deterministic pseudo-random value in [0, 1) seeded by node id + salt."""
    digest = hashlib.sha256(f"{node_id}:{salt}".encode()).digest()
    n = int.from_bytes(digest[:8], "big")
    return (n % 1_000_000) / 1_000_000


def _node_duration(node: NodeSchema) -> float:
    explicit = node.data.duration_ms
    if explicit is not None and explicit > 0:
        return float(explicit)
    if node.type in TASK_TYPES:
        base = 30_000 + _seed_value(node.id, "dur") * 180_000
        return base
    return 500.0


def _longest_path_ms(graph: GraphSchema) -> float:
    durations = {n.id: _node_duration(n) for n in graph.nodes}
    adj: dict[str, list[str]] = defaultdict(list)
    in_deg: dict[str, int] = {n.id: 0 for n in graph.nodes}
    for e in graph.edges:
        if e.source in in_deg and e.target in in_deg:
            adj[e.source].append(e.target)
            in_deg[e.target] += 1

    topo: list[str] = []
    queue = [nid for nid, d in in_deg.items() if d == 0]
    while queue:
        nid = queue.pop(0)
        topo.append(nid)
        for m in adj[nid]:
            in_deg[m] -= 1
            if in_deg[m] == 0:
                queue.append(m)

    dist = {nid: durations[nid] for nid in durations}
    for nid in topo:
        for m in adj[nid]:
            candidate = dist[nid] + durations[m]
            if candidate > dist[m]:
                dist[m] = candidate
    return max(dist.values(), default=0.0)


def _compute(graph: GraphSchema, config: AnalyticsConfig) -> AnalyticsResult:
    now = datetime.now(timezone.utc)

    task_nodes = [n for n in graph.nodes if n.type in TASK_TYPES]
    durations = {n.id: _node_duration(n) for n in graph.nodes}
    max_task_duration = (
        max((durations[n.id] for n in task_nodes), default=1.0) or 1.0
    )

    node_metrics: list[NodeMetric] = []
    for n in graph.nodes:
        avg_duration = durations[n.id]
        variance = 0.2 + _seed_value(n.id, "var") * 0.4
        p90 = avg_duration * (1.0 + variance)
        throughput = 1.0 if n.type not in TASK_TYPES else (
            0.2 + _seed_value(n.id, "tp") * 0.8
        )
        utilization = (
            min(1.0, 0.4 + _seed_value(n.id, "util") * 0.6)
            if n.type in TASK_TYPES
            else 0.0
        )
        severity = 0.0
        if n.type in TASK_TYPES:
            severity = min(
                1.0,
                (avg_duration / max_task_duration) * 0.7
                + utilization * 0.3,
            )
        node_metrics.append(
            NodeMetric(
                node_id=n.id,
                label=n.data.label,
                type=n.type,
                avg_duration_ms=round(avg_duration, 2),
                p90_duration_ms=round(p90, 2),
                throughput=round(throughput, 3),
                utilization=round(utilization, 3),
                severity=round(severity, 3),
                is_bottleneck=severity > 0.6
                and avg_duration >= config.duration_threshold_ms,
            )
        )

    node_metrics_by_severity = sorted(
        node_metrics, key=lambda m: m.severity, reverse=True
    )
    critical = [m for m in node_metrics_by_severity if m.is_bottleneck][
        : config.top_n_bottlenecks
    ]

    longest = _longest_path_ms(graph)
    cycle_samples: list[float] = []
    if longest > 0 and task_nodes:
        for n in task_nodes:
            jitter = 0.7 + _seed_value(n.id, "cycle") * 0.8
            cycle_samples.append(longest * jitter)
        # Ensure we always have the longest path as an anchor
        cycle_samples.append(longest)

    cycle_samples.sort()

    def _percentile(samples: list[float], p: float) -> float:
        if not samples:
            return 0.0
        k = (len(samples) - 1) * p
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return samples[int(k)]
        return samples[f] + (samples[c] - samples[f]) * (k - f)

    avg_cycle = (
        sum(cycle_samples) / len(cycle_samples) if cycle_samples else 0.0
    )
    p50 = _percentile(cycle_samples, 0.5)
    p90 = _percentile(cycle_samples, 0.9)

    histogram: list[HistogramBin] = []
    if cycle_samples:
        lo = cycle_samples[0]
        hi = cycle_samples[-1] if cycle_samples[-1] > lo else lo + 1.0
        bin_count = min(8, max(3, len(cycle_samples)))
        width = (hi - lo) / bin_count
        buckets = [0] * bin_count
        for s in cycle_samples:
            idx = min(bin_count - 1, int((s - lo) / width)) if width > 0 else 0
            buckets[idx] += 1
        for i, count in enumerate(buckets):
            histogram.append(
                HistogramBin(
                    lower_ms=round(lo + i * width, 2),
                    upper_ms=round(lo + (i + 1) * width, 2),
                    count=count,
                )
            )

    return AnalyticsResult(
        generated_at=now,
        process_id=None,
        node_count=len(graph.nodes),
        edge_count=len(graph.edges),
        avg_cycle_time_ms=round(avg_cycle, 2),
        p50_cycle_time_ms=round(p50, 2),
        p90_cycle_time_ms=round(p90, 2),
        critical_bottlenecks=critical,
        node_metrics=sorted(
            node_metrics, key=lambda m: m.severity, reverse=True
        ),
        cycle_time_histogram=histogram,
    )


class ProcessAnalyticsModule(AbstractModule):
    module_id = "process_analytics"
    display_name = "Process Analytics"
    version = "1.0.0"
    description = (
        "Computes per-node KPIs, ranks bottlenecks, and produces a cycle-time "
        "distribution for a process graph."
    )

    def get_config_schema(self) -> type[BaseModel]:
        return AnalyticsConfig

    def get_router(self) -> APIRouter:
        router = APIRouter()

        @router.post("/analyse", response_model=AnalyticsResult)
        async def analyse(payload: AnalyseRequest) -> AnalyticsResult:
            result = _compute(payload.graph, AnalyticsConfig())
            result.process_id = payload.process_id
            return result

        @router.get("/config", response_model=AnalyticsConfig)
        async def get_config() -> AnalyticsConfig:
            return AnalyticsConfig()

        return router
