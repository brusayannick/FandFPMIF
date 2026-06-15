"""Shared AI-config types + accessors.

Lives outside ``routes/`` on purpose: importing anything from ``routes/``
triggers ``routes/__init__.py``, which mounts every router. That would
create a cycle when ``modules/refactor.py`` (used by ``routes/modules.py``)
needs to read the user's API key. Keep this module free of FastAPI route
declarations.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from mate.api.db.models import UserSetting

AI_CONFIG_KEY = "ai.config"

Provider = Literal["anthropic", "openai", "unigpt", "custom"]


class ProviderConfig(BaseModel):
    api_key: str | None = None
    base_url: str | None = None


class AiConfigPayload(BaseModel):
    system_prompt: str = ""
    anthropic: ProviderConfig = Field(default_factory=ProviderConfig)
    openai: ProviderConfig = Field(default_factory=ProviderConfig)
    unigpt: ProviderConfig = Field(default_factory=ProviderConfig)
    custom: ProviderConfig = Field(default_factory=ProviderConfig)
    selected_provider: Provider | None = None
    selected_model: str | None = None
    # Optional cheaper model (same provider) used only for the intent classifier
    # behind MATE AI's navigation routing. Falls back to ``selected_model`` when
    # unset, so existing configs keep working untouched.
    classifier_model: str | None = None


def _load_config(row: UserSetting | None) -> AiConfigPayload:
    if row is None or not isinstance(row.value_json, dict):
        return AiConfigPayload()
    return AiConfigPayload.model_validate(row.value_json)


async def load_ai_config(session: AsyncSession, user_id: str) -> AiConfigPayload:
    row = await session.get(UserSetting, (user_id, AI_CONFIG_KEY))
    return _load_config(row)


async def _provider_creds(
    session: AsyncSession, provider: Provider, user_id: str
) -> tuple[str, str | None]:
    cfg = await load_ai_config(session, user_id)
    p = getattr(cfg, provider)
    if not p.api_key:
        raise HTTPException(
            status_code=400,
            detail=f"No API key configured for {provider!r}. Save one in Settings → AI first.",
        )
    return p.api_key, p.base_url
