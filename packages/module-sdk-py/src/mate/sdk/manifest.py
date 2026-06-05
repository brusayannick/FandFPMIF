"""Pydantic schema for `manifest.yaml` (INSTRUCTIONS.md §5.1).

Validated by the SDK so module authors can sanity-check their manifest
locally, and by the platform loader at startup. The loader rejects manifests
with hard-dep cycles, missing required fields, or `inherit:`/`packages:`
overlap (§5.4 inherit-conflict rule).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from mate.sdk.errors import ModuleManifestError

ModuleCategory = Literal["foundation", "attribute", "external_input", "advanced", "other"]
IsolationMode = Literal["in_process", "subprocess"]


class EventLogRequirements(BaseModel):
    # Which log model this module operates on. The platform makes a module
    # available only on logs of the matching model — case-centric and
    # object-centric (OCEL) modules never run against each other's logs.
    # Defaults to "case_centric" so every existing module stays case-centric.
    log_model: Literal["case_centric", "object_centric"] = "case_centric"
    required_columns: list[str] = Field(default_factory=list)
    optional_columns: list[str] = Field(default_factory=list)
    min_events: int | None = None
    min_cases: int | None = None


class OptionalModuleDep(BaseModel):
    id: str
    reason: str | None = None


class Requirements(BaseModel):
    event_log: EventLogRequirements = Field(default_factory=EventLogRequirements)
    modules: list[str] = Field(default_factory=list)
    optional_modules: list[OptionalModuleDep] = Field(default_factory=list)


class DependenciesPython(BaseModel):
    requires_python: str | None = Field(default=None, alias="requires-python")
    packages: list[str] = Field(default_factory=list)
    inherit: list[str] = Field(default_factory=list)
    isolation: IsolationMode = "in_process"

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _no_inherit_conflict(self) -> Self:
        # `pandas` cannot appear in both `packages` and `inherit`.
        pkg_names = {p.split(">=", 1)[0].split("==", 1)[0].split("<", 1)[0].split("~", 1)[0].strip().lower() for p in self.packages}
        for name in self.inherit:
            if name.lower() in pkg_names:
                raise ModuleManifestError(
                    f"`{name}` is in both dependencies.python.inherit and dependencies.python.packages — "
                    "pick one. Inherit reuses the platform's version; packages installs a private copy."
                )
        return self


class Dependencies(BaseModel):
    python: DependenciesPython = Field(default_factory=DependenciesPython)
    npm: list[str] = Field(default_factory=list)


class WidgetEntry(BaseModel):
    """A reusable frontend widget ("card") a module exposes.

    Beyond the `id`/`entry` the bundler needs, the optional display fields are
    surfaced by the platform's card catalog (`GET /api/v1/modules/cards`) so
    the Dashboards palette can list every module's cards without loading their
    bundles. `default_w`/`default_h` are react-grid-layout cells (12-col grid).
    """

    id: str
    entry: str
    title: str | None = None
    description: str | None = None
    # Lucide icon name (e.g. "Activity"); the frontend maps it to a glyph and
    # falls back to a generic chart icon when unknown or absent.
    icon: str | None = None
    default_w: int = 6
    default_h: int = 8
    # Optional per-card settings, declared in the same JSON-Schema-flavoured
    # dialect as a module's top-level `config_schema` (`{properties: {...}}`
    # with `type`/`title`/`enum`/`minimum`/`ui.widget` ...). The Dashboards
    # palette surfaces it (`/modules/cards`) and renders a settings form per
    # placed card in edit mode; the chosen values land in the placement's
    # `config` and are passed to the widget as its `config` prop.
    config_schema: dict[str, Any] | None = None


class PageLayoutSection(BaseModel):
    section: str
    widgets: list[str] = Field(default_factory=list)


class ManifestFrontend(BaseModel):
    panel: str | None = None
    side_rail: str | None = None
    widgets: list[WidgetEntry] = Field(default_factory=list)
    page_layout: list[PageLayoutSection] = Field(default_factory=list)


class AiModelSlot(BaseModel):
    """One labelled (provider, model) selector exposed on the module's
    settings page. The actual API keys come from the platform's global
    Settings → AI; the module only persists the user's chosen pair."""

    title: str
    description: str | None = None


class AiModelsManifest(BaseModel):
    """Declares the AI-model selectors a module needs on its settings page.

    Typical usage is ``llm`` (for chat agents) + ``embedding`` (for retrieval),
    but any string-keyed slot is accepted so a module could declare extra
    roles (e.g. a separate vision model).
    """

    model_config = ConfigDict(extra="allow")

    llm: AiModelSlot | None = None
    embedding: AiModelSlot | None = None


class Manifest(BaseModel):
    """The top-level manifest object — `manifest.yaml`."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    name: str
    version: str
    category: ModuleCategory
    description: str | None = None
    author: str | None = None
    license: str | None = None

    requirements: Requirements = Field(default_factory=Requirements)
    provides: list[str] = Field(default_factory=list)
    consumes: list[str] = Field(default_factory=list)
    dependencies: Dependencies = Field(default_factory=Dependencies)
    frontend: ManifestFrontend = Field(default_factory=ManifestFrontend)
    permissions: list[str] = Field(default_factory=list)
    default_enabled: bool = True
    # Whether the module is safe to run against confidential data — i.e. it
    # processes the event log entirely locally and never ships data to an
    # external service. When the user enables "Show only confidential modules"
    # in platform settings, modules with this set to `false` are hidden.
    # Defaults to `false` so a module is only treated as safe when it
    # explicitly opts in.
    is_confidential_safe: bool = Field(default=False, alias="isConfidentialSafe")
    # JSON-Schema-flavoured dict so module authors write it in YAML. The
    # platform passes it through to the frontend as-is (`/config-schema`);
    # form-rendering and validation are the frontend's responsibility.
    config_schema: dict[str, Any] | None = None
    # Optional declaration of AI-model selectors. When present, the module's
    # settings page renders an "AI models" card and the chosen (provider,
    # model) pairs are persisted under ``module_configs.config_json["ai"]``.
    ai_models: AiModelsManifest | None = None

    @model_validator(mode="after")
    def _validate_id(self) -> Self:
        if not self.id.replace("_", "").isalnum() or not self.id.islower():
            raise ModuleManifestError(
                f"Manifest id {self.id!r} must be lowercase snake_case (letters, digits, underscores)."
            )
        return self

    @classmethod
    def load_yaml(cls, path: Path | str) -> Manifest:
        path = Path(path)
        try:
            data = yaml.safe_load(path.read_text())
        except yaml.YAMLError as exc:
            raise ModuleManifestError(f"Invalid YAML in {path}: {exc}") from exc
        if not isinstance(data, dict):
            raise ModuleManifestError(f"Manifest at {path} is not a YAML mapping.")
        try:
            return cls.model_validate(data)
        except Exception as exc:
            raise ModuleManifestError(f"Manifest validation failed for {path}: {exc}") from exc

    def dependencies_hash(self) -> str:
        """Stable hash of the dependencies block — used to skip `uv sync` on
        unchanged boots (§5.4)."""
        import hashlib
        import json

        payload = json.dumps(self.dependencies.model_dump(by_alias=True), sort_keys=True)
        return hashlib.blake2b(payload.encode("utf-8"), digest_size=16).hexdigest()
