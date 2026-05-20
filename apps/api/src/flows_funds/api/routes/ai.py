"""/api/v1/ai — AI chat configuration and provider proxies.

The API keys and system prompt live as a single JSON blob in
``user_settings`` under the ``ai.config`` key. The provider model and
pricing endpoints proxy through the backend so that:

* keys never leave the SQLite database,
* we sidestep browser CORS restrictions on provider ``/v1/models`` endpoints, and
* the public litellm pricing catalog can be cached server-side with a TTL.
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import json
import time
from collections.abc import AsyncGenerator
from typing import Annotated, Any, Literal

import httpx
import structlog
from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from flows_funds.api.ai_config import (
    AI_CONFIG_KEY,
    AiConfigPayload,
    Provider,
    ProviderConfig,
    _load_config,
    _provider_creds,
)
from flows_funds.api.db.models import UserSetting
from flows_funds.api.db.session import SessionDep

# Re-exported so any caller that previously imported these names from
# `routes.ai` still works. The real definitions live in `_ai_config`.
__all__ = [
    "AI_CONFIG_KEY",
    "AiConfigPayload",
    "Provider",
    "ProviderConfig",
    "_load_config",
    "_provider_creds",
    "router",
]

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])

LITELLM_PRICING_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/"
    "model_prices_and_context_window.json"
)
_PRICING_TTL_SECONDS = 3600


@router.get("/config", response_model=AiConfigPayload)
async def get_config(session: SessionDep) -> AiConfigPayload:
    row = await session.get(UserSetting, AI_CONFIG_KEY)
    return _load_config(row)


@router.put("/config", response_model=AiConfigPayload)
async def put_config(
    payload: AiConfigPayload,
    session: SessionDep,
) -> AiConfigPayload:
    row = await session.get(UserSetting, AI_CONFIG_KEY)
    data = payload.model_dump()
    if row is None:
        session.add(UserSetting(key=AI_CONFIG_KEY, value_json=data))
    else:
        row.value_json = data
    await session.commit()
    return payload


# --------------------------------------------------------------------------
# Provider model listing — proxied so keys stay server-side and CORS is moot
# --------------------------------------------------------------------------


class ModelInfo(BaseModel):
    id: str
    display_name: str | None = None
    created: int | None = None


class FetchModelsResponse(BaseModel):
    models: list[ModelInfo]


def _iso_to_epoch(s: Any) -> int | None:
    if not isinstance(s, str):
        return None
    try:
        return int(_dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def _openai_compat_models_url(base_url: str) -> str:
    """Construct the /models endpoint URL for an OpenAI-compatible backend.

    Follows OpenAI SDK convention: base_url is the versioned API prefix (e.g.,
    https://api.openai.com/v1 or https://gpt.uni-muenster.de/v1), and only
    the endpoint path (/models) is appended.
    """
    return f"{base_url.rstrip('/')}/models"


@router.post("/models/{provider}", response_model=FetchModelsResponse)
async def fetch_models(
    provider: Annotated[Provider, Path()],
    session: SessionDep,
) -> FetchModelsResponse:
    api_key, base_url = await _provider_creds(session, provider)

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            if provider == "anthropic":
                url = "https://api.anthropic.com/v1/models"
                r = await client.get(
                    url,
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                    },
                )
                _raise_provider_error(provider, r, url=url)
                data = _parse_json(r, provider=provider, url=url)
                return FetchModelsResponse(
                    models=[
                        ModelInfo(
                            id=m["id"],
                            display_name=m.get("display_name"),
                            created=_iso_to_epoch(m.get("created_at")),
                        )
                        for m in data.get("data", [])
                        if isinstance(m, dict) and "id" in m
                    ]
                )

            if provider == "openai":
                url = "https://api.openai.com/v1/models"
                r = await client.get(
                    url,
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                _raise_provider_error(provider, r, url=url)
                data = _parse_json(r, provider=provider, url=url)
                return FetchModelsResponse(
                    models=[
                        ModelInfo(id=m["id"], created=m.get("created"))
                        for m in data.get("data", [])
                        if isinstance(m, dict) and "id" in m
                    ]
                )

            # UniGPT / LibreChat — treat as an OpenAI-compatible backend at the
            # user-supplied base URL.
            if not base_url:
                raise HTTPException(
                    status_code=400,
                    detail="UniGPT requires a base URL in addition to the API key.",
                )
            url = _openai_compat_models_url(base_url)
            r = await client.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            _raise_provider_error(provider, r, url=url)
            data = _parse_json(r, provider=provider, url=url)
            items = data.get("data", []) if isinstance(data, dict) else data
            return FetchModelsResponse(
                models=[
                    ModelInfo(id=m["id"], created=m.get("created"))
                    for m in items
                    if isinstance(m, dict) and "id" in m
                ]
            )
    except httpx.HTTPError as exc:
        log.warning("ai.models.proxy_failed", provider=provider, error=str(exc))
        raise HTTPException(
            status_code=502, detail=f"Provider request failed: {exc}"
        ) from exc


def _parse_json(response: httpx.Response, provider: str, url: str | None = None) -> Any:
    try:
        return response.json()
    except ValueError:
        snippet = response.text[:300]
        error_detail: dict[str, Any] = {
            "provider": provider,
            "upstream": f"Non-JSON response: {snippet!r}",
        }
        if url:
            error_detail["url"] = url
        raise HTTPException(status_code=502, detail=error_detail)


def _raise_provider_error(
    provider: str, response: httpx.Response, url: str | None = None
) -> None:
    if response.is_success:
        return
    # Forward the upstream status so the frontend can distinguish auth (401),
    # rate-limit (429), etc. We always wrap the body in a string detail.
    body: Any = None
    try:
        body = response.json()
    except ValueError:
        body = response.text
    detail = body if isinstance(body, str) else (body.get("error") if isinstance(body, dict) else body)
    error_detail: dict[str, Any] = {"provider": provider, "upstream": detail}
    if url:
        error_detail["url"] = url
    raise HTTPException(
        status_code=response.status_code,
        detail=error_detail,
    )


# --------------------------------------------------------------------------
# Pricing catalog (litellm)
# --------------------------------------------------------------------------


_pricing_cache: dict[str, Any] | None = None
_pricing_cache_at: float = 0.0
_pricing_lock = asyncio.Lock()


@router.get("/pricing")
async def get_pricing() -> dict[str, Any]:
    """Return the litellm price catalog keyed by model id.

    Cached in-process for one hour. The shape is whatever litellm publishes —
    the frontend reads ``input_cost_per_token`` / ``output_cost_per_token`` /
    ``max_tokens`` / ``litellm_provider`` per entry.
    """

    global _pricing_cache, _pricing_cache_at
    now = time.time()
    if _pricing_cache is not None and now - _pricing_cache_at < _PRICING_TTL_SECONDS:
        return _pricing_cache
    async with _pricing_lock:
        if _pricing_cache is not None and now - _pricing_cache_at < _PRICING_TTL_SECONDS:
            return _pricing_cache
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.get(LITELLM_PRICING_URL)
                r.raise_for_status()
                fresh: dict[str, Any] = r.json()
                _pricing_cache = fresh
                _pricing_cache_at = now
                return fresh
        except httpx.HTTPError as exc:
            log.warning("ai.pricing.fetch_failed", error=str(exc))
            # If we have *any* prior payload, fall back to it rather than 502.
            if _pricing_cache is not None:
                return _pricing_cache
            raise HTTPException(
                status_code=502,
                detail=f"Could not fetch pricing catalog: {exc}",
            ) from exc


# --------------------------------------------------------------------------
# Chat — streaming endpoint
# --------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


def _sse(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data)}\n\n"


@router.post("/chat")
async def chat(payload: ChatRequest, session: SessionDep) -> StreamingResponse:
    row = await session.get(UserSetting, AI_CONFIG_KEY)
    cfg = _load_config(row)

    if not cfg.selected_provider or not cfg.selected_model:
        raise HTTPException(
            status_code=400,
            detail="No AI model selected. Configure one in Settings → AI.",
        )
    p = getattr(cfg, cfg.selected_provider)
    if not p.api_key:
        raise HTTPException(
            status_code=400,
            detail=f"No API key configured for {cfg.selected_provider!r}. Go to Settings → AI.",
        )

    return StreamingResponse(
        _stream_chat(cfg, payload.messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream_chat(
    cfg: AiConfigPayload, messages: list[ChatMessage]
) -> AsyncGenerator[str, None]:
    provider = cfg.selected_provider
    p = getattr(cfg, provider)
    try:
        if provider == "anthropic":
            async for chunk in _stream_anthropic(cfg, messages):
                yield chunk
        else:
            base_url = (
                "https://api.openai.com/v1" if provider == "openai" else (p.base_url or "")
            )
            async for chunk in _stream_openai_compat(cfg, messages, base_url, p.api_key):
                yield chunk
    except httpx.HTTPError as exc:
        log.warning("ai.chat.stream_failed", provider=provider, error=str(exc))
        yield _sse({"error": str(exc)})


async def _stream_anthropic(
    cfg: AiConfigPayload, messages: list[ChatMessage]
) -> AsyncGenerator[str, None]:
    p = cfg.anthropic
    body: dict[str, Any] = {
        "model": cfg.selected_model,
        "max_tokens": 8096,
        "messages": [{"role": m.role, "content": m.content} for m in messages],
        "stream": True,
    }
    if cfg.system_prompt:
        body["system"] = cfg.system_prompt

    timeout = httpx.Timeout(120.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client, client.stream(
        "POST",
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": p.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=body,
    ) as r:
        if not r.is_success:
            raw = await r.aread()
            yield _sse({"error": f"Anthropic {r.status_code}: {raw.decode()[:300]}"})
            return
        async for line in r.aiter_lines():
            if not line.startswith("data:"):
                continue
            try:
                evt = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if evt.get("type") == "content_block_delta":
                delta = evt.get("delta", {})
                if delta.get("type") == "text_delta" and delta.get("text"):
                    yield _sse({"delta": delta["text"]})
    yield _sse({"done": True})


async def _stream_openai_compat(
    cfg: AiConfigPayload,
    messages: list[ChatMessage],
    base_url: str,
    api_key: str,
) -> AsyncGenerator[str, None]:
    msgs: list[dict[str, str]] = []
    if cfg.system_prompt:
        msgs.append({"role": "system", "content": cfg.system_prompt})
    msgs.extend({"role": m.role, "content": m.content} for m in messages)

    timeout = httpx.Timeout(120.0, connect=10.0)
    url = f"{base_url.rstrip('/')}/chat/completions"
    async with httpx.AsyncClient(timeout=timeout) as client, client.stream(
        "POST",
        url,
        headers={"Authorization": f"Bearer {api_key}", "content-type": "application/json"},
        json={"model": cfg.selected_model, "messages": msgs, "stream": True},
    ) as r:
        if not r.is_success:
            raw = await r.aread()
            yield _sse({"error": f"{r.status_code}: {raw.decode()[:300]}"})
            return
        async for line in r.aiter_lines():
            if not line.startswith("data:"):
                continue
            raw_str = line[5:].strip()
            if raw_str == "[DONE]":
                break
            try:
                evt = json.loads(raw_str)
            except json.JSONDecodeError:
                continue
            choices = evt.get("choices", [])
            if choices:
                content = choices[0].get("delta", {}).get("content") or ""
                if content:
                    yield _sse({"delta": content})
    yield _sse({"done": True})
