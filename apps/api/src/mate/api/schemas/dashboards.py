"""Pydantic request/response schemas for /api/v1/dashboards.

A dashboard is a grid of cards (each `(module_id, widget_id)`) bound to one
event log. The placed cards and their react-grid-layout geometry travel
together as a list of `DashboardItem` so a save is one atomic write and the
export payload is a straight passthrough.
"""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from mate.api.schemas.common import UtcDateTime
from mate.api.schemas.event_logs import LogModel

# Canvas grid granularity - how finely cards snap and how much they're spaced.
# The pixel geometry per level lives in the web app (dashboard-queries.ts); the
# backend only stores the chosen level.
Granularity = Literal["free", "fine", "medium", "low"]


class CardChrome(BaseModel):
    """Board-wide card appearance toggles. Applied to every placed card when the
    board renders (the per-card widget itself is untouched)."""

    border: bool = True


class FilterPreset(BaseModel):
    """A named, saved set of global column filters (a "saved filter"). The board can
    mark one as active (``CanvasSettings.active_preset_id``) so it applies on
    load in view mode. ``filters`` mirrors the web ``FilterEntry`` shape but is
    kept as opaque dicts here - the same leniency the ephemeral filter header
    gets; ``EventLogAccess`` validates fields when it bakes the predicate."""

    id: str
    name: str
    filters: list[dict[str, Any]] = Field(default_factory=list)


class CanvasSettings(BaseModel):
    """Per-board canvas preferences. Stored alongside ``items`` in the layout
    blob. Fields here must be declared explicitly: the blob round-trips through
    this model (``model_validate`` / ``model_dump``), so any undeclared key
    would be silently dropped on the next save."""

    granularity: Granularity = "medium"
    chrome: CardChrome = Field(default_factory=CardChrome)
    presets: list[FilterPreset] = Field(default_factory=list)
    active_preset_id: str | None = None
    # The board's *committed live view* - the owner's current column-filter bar
    # and time-range window, persisted here so a shared board opens on exactly
    # the owner's filtered view (the recipient reads them off the detail
    # response and seeds their ephemeral filter state). ``None`` (absent, e.g.
    # legacy boards) means "never committed" - the web app then falls back to
    # the active preset for columns. Opaque dicts, same as ``FilterPreset``.
    column_filters: list[dict[str, Any]] | None = None
    time_filters: list[dict[str, Any]] | None = None


class DatasetRef(BaseModel):
    """Points a ``kind="viz"`` card at a module dataset (manifest ``datasets:``).
    The card fetches the data from the module's own route and renders it with a
    generic visualization."""

    module_id: str
    dataset_id: str


class DashboardItem(BaseModel):
    """One placed card and its grid geometry. The column count is set by the
    board's granularity (web ``GRANULARITY``), so ``x``/``w`` are bounded by the
    finest level's column count (60) rather than a fixed 12.

    Two card kinds share this shape (discriminated by ``kind``):
      * ``widget`` (default) - a module-authored React component, addressed by
        ``module_id`` + ``widget_id`` (the original, pre-existing shape).
      * ``viz`` - a generic visualization bound to a module **dataset**,
        addressed by ``dataset_ref`` + ``viz_id`` + ``mapping``.
    Items stored before ``kind`` existed deserialize as ``widget`` (the default)
    and keep working, so no migration is needed."""

    i: str  # stable client id for this placement
    kind: Literal["widget", "viz"] = "widget"
    # widget cards: both required when kind == "widget".
    module_id: str | None = None
    widget_id: str | None = None
    # viz cards: dataset_ref is required at drop; viz_id/mapping are filled in
    # when the user configures the card (a freshly dropped viz card renders an
    # "unconfigured" state until then).
    dataset_ref: DatasetRef | None = None
    viz_id: str | None = None
    # Field-mapping: viz field key -> column id (or list). Opaque to the backend.
    mapping: dict[str, Any] = Field(default_factory=dict)
    title: str | None = None
    x: int = Field(default=0, ge=0, le=59)
    y: int = 0
    w: int = Field(default=6, ge=1, le=60)
    h: int = Field(default=8, ge=1, le=48)
    # Per-placement card options (e.g. which metric a chart shows, or a viz's
    # non-field options). Opaque to the backend; the widget/viz interprets it.
    config: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_kind(self) -> Self:
        if self.kind == "widget":
            if not self.module_id or not self.widget_id:
                raise ValueError("A widget card requires module_id and widget_id.")
        elif self.kind == "viz":
            if self.dataset_ref is None:
                raise ValueError("A viz card requires dataset_ref.")
        return self


class DashboardSummary(BaseModel):
    """List-view row - no card payload, just enough for the grid of boards."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None = None
    event_log_id: str | None = None
    log_model: LogModel = "case_centric"
    card_count: int = 0
    updated_at: UtcDateTime


class DashboardDetail(BaseModel):
    id: str
    name: str
    description: str | None = None
    event_log_id: str | None = None
    log_model: LogModel = "case_centric"
    items: list[DashboardItem] = Field(default_factory=list)
    settings: CanvasSettings = Field(default_factory=CanvasSettings)
    created_at: UtcDateTime
    updated_at: UtcDateTime
    # False when the board was opened via a share - the UI then renders it
    # read-only (no edit toolbar, no save). The owner-only mutation routes also
    # 404 for a non-owner, so this is defence-in-depth, not the only gate.
    is_owner: bool = True


class DashboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    event_log_id: str | None = None
    # The board's data model, fixed at creation - drives which cards the palette
    # offers and which logs are bindable. Not editable afterwards.
    log_model: LogModel = "case_centric"
    items: list[DashboardItem] = Field(default_factory=list)
    settings: CanvasSettings = Field(default_factory=CanvasSettings)
    # When set, the board is seeded from a curated starter template: the
    # template's ``items``/``settings``/``log_model`` win over the (empty) fields
    # above. ``None`` (the default) keeps the classic blank-board behaviour, so
    # this is backward compatible. An unknown id is a 404 at create time.
    template_id: str | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Name cannot be empty.")
        return cleaned


class DashboardUpdate(BaseModel):
    """Partial update - only fields present in the body are touched. `items`
    and `event_log_id` are nullable+present-aware so a board can be cleared or
    unbound from its log explicitly."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    event_log_id: str | None = None
    items: list[DashboardItem] | None = None
    settings: CanvasSettings | None = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Name cannot be empty.")
        return cleaned


class DashboardExport(BaseModel):
    """Portable, id-free representation for download / re-import."""

    kind: str = "mate.dashboard"
    version: int = 1
    name: str
    description: str | None = None
    log_model: LogModel = "case_centric"
    items: list[DashboardItem] = Field(default_factory=list)
    settings: CanvasSettings = Field(default_factory=CanvasSettings)


class DashboardImport(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    log_model: LogModel = "case_centric"
    items: list[DashboardItem] = Field(default_factory=list)
    settings: CanvasSettings = Field(default_factory=CanvasSettings)
    event_log_id: str | None = None


class DashboardTemplate(BaseModel):
    """One curated starter board in the "start from template" picker. The card
    payload is seeded server-side at create time, so this listing shape carries
    only the label + a ``card_count`` preview (not the ``items`` themselves)."""

    id: str
    name: str
    description: str
    log_model: LogModel = "case_centric"
    card_count: int = 0
