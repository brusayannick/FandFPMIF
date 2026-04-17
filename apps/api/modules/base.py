from __future__ import annotations

from abc import ABC, abstractmethod
from fastapi import APIRouter
from pydantic import BaseModel

from schemas.graph import GraphSchema


class AbstractModule(ABC):
    """Every module must implement this interface.

    The registry discovers and mounts modules at app startup.
    """

    @property
    @abstractmethod
    def module_id(self) -> str:
        """Unique snake_case identifier, e.g. ``'process_analytics'``."""

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable name shown in the UI module registry."""

    @property
    @abstractmethod
    def version(self) -> str:
        """Semantic version string, e.g. ``'1.0.0'``."""

    @property
    def description(self) -> str | None:
        return None

    @abstractmethod
    def get_router(self) -> APIRouter:
        """Return the module's FastAPI router.

        The registry mounts it at ``/api/v1/modules/{module_id}``.
        """

    @abstractmethod
    def get_config_schema(self) -> type[BaseModel]:
        """Return the Pydantic model describing this module's configuration."""

    def on_startup(self) -> None:
        """Optional: called once when the FastAPI app starts."""

    def on_graph_update(self, graph: GraphSchema) -> None:
        """Optional: called whenever a process graph is saved."""
