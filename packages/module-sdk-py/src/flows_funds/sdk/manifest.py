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

from flows_funds.sdk.errors import ModuleManifestError

ModuleCategory = Literal["foundation", "attribute", "external_input", "advanced", "other"]
IsolationMode = Literal["in_process", "subprocess"]


class EventLogRequirements(BaseModel):
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
    id: str
    entry: str


class PageLayoutSection(BaseModel):
    section: str
    widgets: list[str] = Field(default_factory=list)


class ManifestFrontend(BaseModel):
    panel: str | None = None
    side_rail: str | None = None
    widgets: list[WidgetEntry] = Field(default_factory=list)
    page_layout: list[PageLayoutSection] = Field(default_factory=list)


class Manifest(BaseModel):
    """The top-level manifest object — `manifest.yaml`."""

    model_config = ConfigDict(extra="ignore")

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
    # JSON-Schema-flavoured dict so module authors write it in YAML. The
    # platform passes it through to the frontend as-is (`/config-schema`);
    # form-rendering and validation are the frontend's responsibility.
    config_schema: dict[str, Any] | None = None

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
