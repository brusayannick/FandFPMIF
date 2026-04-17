from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import select, func
from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.dependencies import SessionDep
from models.process import ProcessDefinition, ProcessInstance
from modules.registry import registry
from schemas.graph import GraphSchema


TASK_TYPES = {
    "task",
    "userTask",
    "serviceTask",
    "scriptTask",
    "subprocess",
}

router = APIRouter()


class TrendPoint(BaseModel):
    label: str
    value: float


class KpiCard(BaseModel):
    label: str
    value: float
    unit: str | None = None
    delta_percent: float | None = None
    trend: list[TrendPoint] = Field(default_factory=list)


class DashboardStats(BaseModel):
    generated_at: datetime
    total_processes: int
    active_instances: int
    avg_cycle_time_ms: float
    critical_bottlenecks: int
    module_count: int
    cards: list[KpiCard]


def _graph_avg_task_duration(graph_data: dict) -> tuple[float, int]:
    """Return (avg_task_duration_ms, bottleneck_candidate_count) for a graph."""
    try:
        graph = GraphSchema.model_validate(graph_data or {"nodes": [], "edges": []})
    except Exception:
        return 0.0, 0

    task_durations: list[float] = []
    bottleneck_count = 0
    for n in graph.nodes:
        if n.type not in TASK_TYPES:
            continue
        dur = n.data.duration_ms
        if dur is None or dur <= 0:
            continue
        task_durations.append(float(dur))
        if dur >= 60_000:
            bottleneck_count += 1
    if not task_durations:
        return 0.0, bottleneck_count
    return sum(task_durations) / len(task_durations), bottleneck_count


@router.get("/stats", response_model=DashboardStats)
async def get_stats(session: SessionDep) -> DashboardStats:
    total_processes = int(
        await session.scalar(select(func.count(ProcessDefinition.id))) or 0
    )
    active_instances = int(
        await session.scalar(
            select(func.count(ProcessInstance.id)).where(
                ProcessInstance.status != "completed"
            )
        )
        or 0
    )

    result = await session.execute(
        select(ProcessDefinition.graph, ProcessDefinition.updated_at).order_by(
            ProcessDefinition.updated_at.desc()
        )
    )
    rows = result.all()

    total_avg = 0.0
    bottleneck_total = 0
    count_with_duration = 0
    for graph_data, _ in rows:
        avg, bc = _graph_avg_task_duration(graph_data)
        bottleneck_total += bc
        if avg > 0:
            total_avg += avg
            count_with_duration += 1

    avg_cycle_time = (
        total_avg / count_with_duration if count_with_duration > 0 else 0.0
    )

    module_count = len(registry.all())

    cards = [
        KpiCard(
            label="Total Processes",
            value=total_processes,
            unit="processes",
        ),
        KpiCard(
            label="Active Instances",
            value=active_instances,
            unit="instances",
        ),
        KpiCard(
            label="Avg Task Duration",
            value=round(avg_cycle_time, 0),
            unit="ms",
        ),
        KpiCard(
            label="Critical Bottlenecks",
            value=bottleneck_total,
            unit="nodes",
        ),
    ]

    return DashboardStats(
        generated_at=datetime.now(timezone.utc),
        total_processes=total_processes,
        active_instances=active_instances,
        avg_cycle_time_ms=round(avg_cycle_time, 2),
        critical_bottlenecks=bottleneck_total,
        module_count=module_count,
        cards=cards,
    )


class ActivityItem(BaseModel):
    id: str
    type: str
    title: str
    subtitle: str | None = None
    timestamp: datetime


class ActivityFeed(BaseModel):
    items: list[ActivityItem]


@router.get("/activity", response_model=ActivityFeed)
async def get_activity(session: SessionDep) -> ActivityFeed:
    """Recent platform activity. For now: most recently updated processes."""
    result = await session.execute(
        select(ProcessDefinition)
        .order_by(ProcessDefinition.updated_at.desc())
        .limit(10)
    )
    items: list[ActivityItem] = []
    for row in result.scalars():
        items.append(
            ActivityItem(
                id=row.id,
                type="process_updated",
                title=row.name,
                subtitle=(
                    f"{row.node_count} nodes · {row.edge_count} edges"
                    if row.node_count
                    else "Empty graph"
                ),
                timestamp=row.updated_at,
            )
        )
    return ActivityFeed(items=items)
