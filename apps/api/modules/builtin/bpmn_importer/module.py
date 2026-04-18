from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from lxml import etree
from pydantic import BaseModel, Field

from modules.base import AbstractModule
from schemas.graph import EdgeSchema, GraphSchema, NodeData, NodeSchema, Position


BPMN_NS = {
    "bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "bpmn2": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
    "dc": "http://www.omg.org/spec/DD/20100524/DC",
    "di": "http://www.omg.org/spec/DD/20100524/DI",
}


BPMN_TYPE_MAP: dict[str, str] = {
    "startEvent": "startEvent",
    "endEvent": "endEvent",
    "intermediateThrowEvent": "intermediateEvent",
    "intermediateCatchEvent": "intermediateEvent",
    "boundaryEvent": "intermediateEvent",
    "task": "task",
    "userTask": "userTask",
    "serviceTask": "serviceTask",
    "scriptTask": "scriptTask",
    "manualTask": "task",
    "businessRuleTask": "task",
    "sendTask": "serviceTask",
    "receiveTask": "serviceTask",
    "callActivity": "subprocess",
    "subProcess": "subprocess",
    "exclusiveGateway": "exclusiveGateway",
    "parallelGateway": "parallelGateway",
    "inclusiveGateway": "inclusiveGateway",
    "complexGateway": "exclusiveGateway",
    "eventBasedGateway": "exclusiveGateway",
}


class ImportResult(BaseModel):
    graph: GraphSchema
    imported_node_count: int
    imported_edge_count: int
    skipped_elements: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ImporterConfig(BaseModel):
    layout_fallback_spacing: int = Field(default=180, ge=40, le=1000)
    preserve_ids: bool = Field(default=True)


def _local_tag(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _collect_shapes(root: etree._Element) -> dict[str, tuple[float, float]]:
    shapes: dict[str, tuple[float, float]] = {}
    for shape in root.iter():
        if _local_tag(shape.tag) != "BPMNShape":
            continue
        ref = shape.get("bpmnElement") or shape.get("bpmnElementRef")
        if not ref:
            continue
        bounds = next(
            (
                child
                for child in shape
                if _local_tag(child.tag) == "Bounds"
            ),
            None,
        )
        if bounds is None:
            continue
        try:
            x = float(bounds.get("x", "0"))
            y = float(bounds.get("y", "0"))
        except ValueError:
            continue
        shapes[ref] = (x, y)
    return shapes


def _iter_process_children(root: etree._Element):
    for process in root.iter():
        if _local_tag(process.tag) != "process":
            continue
        for child in process:
            yield child


def _bpmn_to_graph(xml_bytes: bytes, config: ImporterConfig) -> ImportResult:
    try:
        root = etree.fromstring(
            xml_bytes,
            parser=etree.XMLParser(resolve_entities=False, no_network=True),
        )
    except etree.XMLSyntaxError as exc:
        raise ValueError(f"Invalid BPMN XML: {exc}") from exc

    shapes = _collect_shapes(root)

    nodes: list[NodeSchema] = []
    edges: list[EdgeSchema] = []
    skipped: list[str] = []
    warnings: list[str] = []

    x_cursor = 60.0
    y_cursor = 120.0

    for child in _iter_process_children(root):
        tag = _local_tag(child.tag)
        el_id = child.get("id")
        if not el_id:
            skipped.append(f"{tag} (missing id)")
            continue

        if tag == "sequenceFlow":
            source = child.get("sourceRef")
            target = child.get("targetRef")
            if not source or not target:
                skipped.append(f"sequenceFlow {el_id} (missing endpoints)")
                continue
            name = child.get("name")
            edges.append(
                EdgeSchema(
                    id=el_id,
                    source=source,
                    target=target,
                    label=name if name else None,
                    animated=False,
                )
            )
            continue

        mapped = BPMN_TYPE_MAP.get(tag)
        if mapped is None:
            skipped.append(f"{tag} ({el_id})")
            continue

        label = child.get("name") or tag
        position = shapes.get(el_id)
        if position is None:
            position = (x_cursor, y_cursor)
            x_cursor += config.layout_fallback_spacing
            if x_cursor > 1400:
                x_cursor = 60.0
                y_cursor += config.layout_fallback_spacing

        nodes.append(
            NodeSchema(
                id=el_id,
                type=mapped,  # type: ignore[arg-type]
                position=Position(x=position[0], y=position[1]),
                data=NodeData(label=label, status="idle"),
            )
        )

    if not nodes:
        warnings.append("No recognisable BPMN elements found.")

    # Filter out edges that reference missing nodes.
    known_ids = {n.id for n in nodes}
    filtered_edges: list[EdgeSchema] = []
    for e in edges:
        if e.source in known_ids and e.target in known_ids:
            filtered_edges.append(e)
        else:
            skipped.append(f"sequenceFlow {e.id} (dangling endpoint)")

    return ImportResult(
        graph=GraphSchema(nodes=nodes, edges=filtered_edges),
        imported_node_count=len(nodes),
        imported_edge_count=len(filtered_edges),
        skipped_elements=skipped,
        warnings=warnings,
    )


class BpmnImporterModule(AbstractModule):
    module_id = "bpmn_importer"
    display_name = "BPMN Importer"
    version = "1.0.0"
    description = (
        "Parses BPMN 2.0 XML and converts it to the platform graph schema, "
        "preserving positions where a diagram is present."
    )

    def get_config_schema(self) -> type[BaseModel]:
        return ImporterConfig

    def get_router(self) -> APIRouter:
        router = APIRouter()

        @router.post("/import", response_model=ImportResult)
        async def import_bpmn(
            file: UploadFile = File(...),
        ) -> ImportResult:
            if file.size is not None and file.size > 5_000_000:
                raise HTTPException(
                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    "BPMN files larger than 5 MB are not supported.",
                )
            contents = await file.read()
            try:
                return _bpmn_to_graph(contents, ImporterConfig())
            except ValueError as exc:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)
                )

        @router.get("/config", response_model=ImporterConfig)
        async def get_config() -> ImporterConfig:
            return ImporterConfig()

        return router
