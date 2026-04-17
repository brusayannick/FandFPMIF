from __future__ import annotations

import math
import random
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from modules.base import AbstractModule
from schemas.graph import GraphSchema
from services.graph_service import GraphValidationError, validate_dag


TASK_TYPES = {
    "task",
    "userTask",
    "serviceTask",
    "scriptTask",
    "subprocess",
}


class SimulationConfig(BaseModel):
    n_runs: int = Field(default=500, ge=10, le=10_000)
    arrival_rate_per_hour: float = Field(default=10.0, gt=0)
    resource_capacity: int = Field(default=3, ge=1, le=1000)
    duration_variance: float = Field(default=0.3, ge=0, le=2.0)
    seed: int | None = Field(
        default=None,
        description="Optional RNG seed for deterministic replays.",
    )


class SimulationRequest(BaseModel):
    process_id: str | None = None
    graph: GraphSchema
    config: SimulationConfig = Field(default_factory=SimulationConfig)


class TimeSeriesPoint(BaseModel):
    t_hours: float
    completed: int


class PercentileBreakdown(BaseModel):
    p50: float
    p75: float
    p90: float
    p95: float
    p99: float


class SimulationResult(BaseModel):
    generated_at: datetime
    process_id: str | None
    n_runs: int
    mean_cycle_time_ms: float
    median_cycle_time_ms: float
    min_cycle_time_ms: float
    max_cycle_time_ms: float
    std_cycle_time_ms: float
    confidence_interval_95: tuple[float, float]
    percentiles: PercentileBreakdown
    throughput_per_hour: float
    utilization: float
    time_series: list[TimeSeriesPoint]
    warnings: list[str] = Field(default_factory=list)


def _topological_order(graph: GraphSchema) -> list[str]:
    adj: dict[str, list[str]] = defaultdict(list)
    in_deg: dict[str, int] = {n.id: 0 for n in graph.nodes}
    for e in graph.edges:
        adj[e.source].append(e.target)
        in_deg[e.target] += 1

    order: list[str] = []
    queue = [nid for nid, d in in_deg.items() if d == 0]
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for m in adj[nid]:
            in_deg[m] -= 1
            if in_deg[m] == 0:
                queue.append(m)
    return order


def _outgoing_map(graph: GraphSchema) -> dict[str, list[str]]:
    out: dict[str, list[str]] = defaultdict(list)
    for e in graph.edges:
        out[e.source].append(e.target)
    return out


def _percentile(samples: list[float], p: float) -> float:
    if not samples:
        return 0.0
    s = sorted(samples)
    k = (len(s) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] + (s[c] - s[f]) * (k - f)


def _sample_duration(base_ms: float, variance: float, rng: random.Random) -> float:
    if base_ms <= 0:
        return 0.0
    # Lognormal-ish: mean = base_ms, sigma derived from variance parameter.
    if variance <= 0:
        return base_ms
    sigma = max(0.01, min(1.5, variance))
    mu = math.log(max(1.0, base_ms)) - (sigma * sigma) / 2
    return max(0.0, rng.lognormvariate(mu, sigma))


def _run_simulation(
    graph: GraphSchema, config: SimulationConfig
) -> SimulationResult:
    rng = random.Random(config.seed)

    starts = [n for n in graph.nodes if n.type == "startEvent"]
    ends = {n.id for n in graph.nodes if n.type == "endEvent"}
    if not starts or not ends:
        raise GraphValidationError(
            "Simulation requires at least one start event and one end event."
        )

    nodes_by_id = {n.id: n for n in graph.nodes}
    outgoing = _outgoing_map(graph)

    cycle_times: list[float] = []

    default_duration = 60_000.0

    for _ in range(config.n_runs):
        start_node = starts[rng.randrange(len(starts))]
        current = start_node.id
        total = 0.0
        visited_safety = 0
        while current not in ends and visited_safety < len(graph.nodes) * 2:
            node = nodes_by_id.get(current)
            if node is None:
                break
            base = (
                node.data.duration_ms
                if node.type in TASK_TYPES and node.data.duration_ms
                else (
                    default_duration
                    if node.type in TASK_TYPES
                    else 500.0
                )
            )
            total += _sample_duration(base, config.duration_variance, rng)

            options = outgoing.get(current, [])
            if not options:
                break
            if node.type == "parallelGateway" and len(options) > 1:
                extra_branches = [
                    nodes_by_id[o].data.duration_ms or 30_000
                    for o in options[1:]
                    if o in nodes_by_id
                ]
                if extra_branches:
                    total += max(
                        _sample_duration(
                            float(x), config.duration_variance, rng
                        )
                        for x in extra_branches
                    )
                current = options[0]
            else:
                current = options[rng.randrange(len(options))]
            visited_safety += 1

        cycle_times.append(total)

    if not cycle_times:
        raise GraphValidationError(
            "Simulation produced no samples — graph is not executable."
        )

    mean = sum(cycle_times) / len(cycle_times)
    std = math.sqrt(
        sum((x - mean) ** 2 for x in cycle_times) / max(1, len(cycle_times) - 1)
    )
    z = 1.96
    ci_half = z * std / math.sqrt(len(cycle_times))
    median = _percentile(cycle_times, 0.5)
    p = PercentileBreakdown(
        p50=round(median, 2),
        p75=round(_percentile(cycle_times, 0.75), 2),
        p90=round(_percentile(cycle_times, 0.9), 2),
        p95=round(_percentile(cycle_times, 0.95), 2),
        p99=round(_percentile(cycle_times, 0.99), 2),
    )

    hour_ms = 3_600_000.0
    total_time_hours = sum(cycle_times) / hour_ms
    throughput_per_hour = (
        len(cycle_times) / total_time_hours if total_time_hours > 0 else 0.0
    )

    offered_per_hour = config.arrival_rate_per_hour * (mean / hour_ms)
    utilization = min(1.0, offered_per_hour / max(1, config.resource_capacity))

    max_total_hours = max(cycle_times) / hour_ms
    bins = 12
    step = max_total_hours / bins if max_total_hours > 0 else 0
    time_series: list[TimeSeriesPoint] = []
    if step > 0:
        cumulative = 0
        sorted_times = sorted(cycle_times)
        idx = 0
        for i in range(1, bins + 1):
            threshold = step * i * hour_ms
            while idx < len(sorted_times) and sorted_times[idx] <= threshold:
                cumulative += 1
                idx += 1
            time_series.append(
                TimeSeriesPoint(t_hours=round(step * i, 3), completed=cumulative)
            )

    return SimulationResult(
        generated_at=datetime.now(timezone.utc),
        process_id=None,
        n_runs=config.n_runs,
        mean_cycle_time_ms=round(mean, 2),
        median_cycle_time_ms=round(median, 2),
        min_cycle_time_ms=round(min(cycle_times), 2),
        max_cycle_time_ms=round(max(cycle_times), 2),
        std_cycle_time_ms=round(std, 2),
        confidence_interval_95=(
            round(max(0.0, mean - ci_half), 2),
            round(mean + ci_half, 2),
        ),
        percentiles=p,
        throughput_per_hour=round(throughput_per_hour, 3),
        utilization=round(utilization, 3),
        time_series=time_series,
    )


class ProcessSimulationModule(AbstractModule):
    module_id = "process_simulation"
    display_name = "Process Simulation"
    version = "1.0.0"
    description = (
        "Runs a configurable Monte Carlo simulation over a process graph and "
        "returns percentile cycle-time breakdowns."
    )

    def get_config_schema(self) -> type[BaseModel]:
        return SimulationConfig

    def get_router(self) -> APIRouter:
        router = APIRouter()

        @router.post("/run", response_model=SimulationResult)
        async def run(payload: SimulationRequest) -> SimulationResult:
            try:
                validate_dag(payload.graph, strict=True)
                result = _run_simulation(payload.graph, payload.config)
            except GraphValidationError as exc:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)
                )
            result.process_id = payload.process_id
            return result

        @router.get("/config", response_model=SimulationConfig)
        async def get_config() -> SimulationConfig:
            return SimulationConfig()

        return router
