"""Intent-based navigation routing for MATE AI.

Turns a free-text chat message into zero or more *navigation suggestions* —
clickable targets that drop the user inside a module panel or a platform page.

Pipeline (see ``route_intent``):

1. Build a per-user **destination registry** (``build_user_destinations``): the
   static platform pages plus every module the user has *enabled*. Tenant
   isolation is preserved — only the requesting user's installs are visible.
2. A cheap **local keyword pre-filter** (``prefilter``) short-circuits the two
   unambiguous cases so we never pay for an LLM call:
   * no destination mentioned *and* no navigation verb → pure chat, no targets;
   * an explicit navigation verb *and* exactly one matching destination →
     navigate straight there.
3. Everything in between goes to the **LLM classifier** (``classify_intent``),
   reusing ``structured_completion`` so UniGPT/custom backends get the
   prompted-JSON fallback for free. The classifier runs on ``classifier_model``
   (a cheaper model, same provider) when configured.
4. The chosen target ids are **resolved** to concrete hrefs (``resolve_targets``),
   handling the module-panel-needs-a-log case.

Kept out of ``routes/`` for the same import-cycle reason as ``ai_config`` and
``ai_guidance``.
"""

from __future__ import annotations

import re
from typing import Any, Literal

import structlog
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mate.api.ai_config import AiConfigPayload
from mate.api.ai_guidance import GuidanceError, structured_completion

log = structlog.get_logger(__name__)

# A suggestion below this confidence is dropped — navigation is additive, so we
# err towards *not* nagging the user with a low-confidence guess.
NAV_CONFIDENCE_THRESHOLD = 0.7
# Confidence we assign to a deterministic (non-LLM) pre-filter hit.
PREFILTER_CONFIDENCE = 0.95


# ── Destination model ───────────────────────────────────────────────────────


class NavDestination(BaseModel):
    """One thing the user can be routed to (a module panel or a platform page)."""

    id: str
    label: str
    kind: Literal["module", "page"]
    # ``str.format(log_id=...)`` template. Pages ignore the placeholder.
    href_template: str
    requires_log: bool
    keywords: list[str] = []
    description: str = ""


class NavTarget(BaseModel):
    """A resolved, clickable suggestion handed to the frontend."""

    id: str
    label: str
    kind: str
    href: str
    # True when the target needs a process/log that the current context lacks —
    # the frontend renders it as a hint ("open a process first") rather than a
    # dead link, and falls back ``href`` to the module's config page.
    requires_log: bool
    available: bool


class RoutingResult(BaseModel):
    intent: Literal["chat", "navigate", "both"]
    confidence: float
    targets: list[NavTarget]


# ── Static platform pages ───────────────────────────────────────────────────

# Routes mirror the web app's sidebar + settings tabs. Keywords are curated so
# the pre-filter and the LLM both have strong signal for non-module surfaces.
PLATFORM_PAGES: list[NavDestination] = [
    NavDestination(
        id="processes",
        label="Processes",
        kind="page",
        href_template="/processes",
        requires_log=False,
        keywords=["process", "processes", "event log", "logs", "cases", "upload log", "prozesse"],
        description="Browse, open and manage uploaded event logs / processes.",
    ),
    NavDestination(
        id="processes.import",
        label="Import a process",
        kind="page",
        href_template="/processes/import",
        requires_log=False,
        keywords=["import", "upload", "new log", "add log", "csv", "xes", "ingest", "importieren"],
        description="Upload a new XES/CSV event log.",
    ),
    NavDestination(
        id="dashboards",
        label="Dashboards",
        kind="page",
        href_template="/dashboards",
        requires_log=False,
        keywords=["dashboard", "dashboards", "board", "widgets", "overview", "übersicht"],
        description="Create and view dashboards composed of module widgets.",
    ),
    NavDestination(
        id="modules",
        label="Modules",
        kind="page",
        href_template="/modules",
        requires_log=False,
        keywords=["module", "modules", "install module", "enable module", "plugins", "module"],
        description="Install, enable/disable and configure analysis modules.",
    ),
    NavDestination(
        id="modules.import",
        label="Install a module",
        kind="page",
        href_template="/modules/import",
        requires_log=False,
        keywords=["install module", "upload module", "add module", "new module", "modul installieren"],
        description="Upload/install a new module package.",
    ),
    NavDestination(
        id="settings.general",
        label="General settings",
        kind="page",
        href_template="/settings/general",
        requires_log=False,
        keywords=["settings", "preferences", "general", "einstellungen", "theme", "appearance"],
        description="General platform preferences.",
    ),
    NavDestination(
        id="settings.ai",
        label="AI settings",
        kind="page",
        href_template="/settings/ai",
        requires_log=False,
        keywords=[
            "ai settings",
            "ai config",
            "api key",
            "model",
            "provider",
            "anthropic",
            "openai",
            "unigpt",
            "system prompt",
            "ki einstellungen",
        ],
        description="Configure the AI provider, API key, models and system prompt.",
    ),
    NavDestination(
        id="settings.privacy",
        label="Privacy settings",
        kind="page",
        href_template="/settings/privacy",
        requires_log=False,
        keywords=["privacy", "data collection", "analytics", "tracking", "datenschutz", "consent"],
        description="Data-collection and privacy preferences.",
    ),
    NavDestination(
        id="settings.about",
        label="About",
        kind="page",
        href_template="/settings/about",
        requires_log=False,
        keywords=["about", "version", "build", "license", "über"],
        description="Version and build information.",
    ),
    NavDestination(
        id="profile",
        label="Profile",
        kind="page",
        href_template="/profile",
        requires_log=False,
        keywords=["profile", "account", "my account", "password", "sign out", "profil", "konto"],
        description="Your user profile and account.",
    ),
]


# ── Registry construction ───────────────────────────────────────────────────


def _derive_keywords(name: str, description: str | None, provides: list[str]) -> list[str]:
    """Fallback keywords when a manifest declares none."""
    words: list[str] = []
    words.extend(re.findall(r"[a-z0-9]+", name.lower()))
    if description:
        words.extend(re.findall(r"[a-z0-9]+", description.lower())[:12])
    # Capability ids like "discovery.petri_net.alpha" → "discovery", "petri", ...
    for cap in provides:
        words.extend(re.findall(r"[a-z0-9]+", cap.lower()))
    # De-dupe, drop trivially short tokens, keep order.
    seen: set[str] = set()
    out: list[str] = []
    for w in words:
        if len(w) < 3 or w in seen:
            continue
        seen.add(w)
        out.append(w)
    return out[:20]


async def build_user_destinations(session: AsyncSession, user_id: str) -> list[NavDestination]:
    """Static pages + the modules this user has installed *and* enabled."""
    dests = list(PLATFORM_PAGES)

    # Local imports keep this module free of the loader's lifecycle at import
    # time (the loader pulls in the whole module subsystem).
    from fastapi import HTTPException

    from mate.api.db.models import ModuleConfig
    from mate.api.modules import get_module_loader
    from mate.api.modules.installs import user_module_ids

    try:
        loader = get_module_loader()
    except HTTPException:
        return dests

    manifests = loader.manifests()
    if not manifests:
        return dests

    owned = await user_module_ids(session, user_id)
    rows = await session.execute(
        select(ModuleConfig.module_id, ModuleConfig.enabled).where(ModuleConfig.user_id == user_id)
    )
    enabled_map: dict[str, bool] = {mid: en for mid, en in rows.all()}

    for m in manifests:
        if m.id not in owned:
            continue
        if not enabled_map.get(m.id, m.default_enabled):
            continue
        keywords = list(m.keywords) or _derive_keywords(m.name, m.description, list(m.provides))
        dests.append(
            NavDestination(
                id=m.id,
                label=m.name,
                kind="module",
                href_template="/processes/{log_id}/modules/" + m.id,
                requires_log=True,
                keywords=keywords,
                description=(m.description or m.name)[:300],
            )
        )
    return dests


def build_destination_catalog(destinations: list[NavDestination]) -> str:
    """Render the registry as a compact list for the classifier system prompt."""
    lines: list[str] = []
    for d in destinations:
        kw = ", ".join(d.keywords[:8])
        lines.append(f"- id={d.id} | {d.label} ({d.kind}): {d.description} | keywords: {kw}")
    return "\n".join(lines)


# ── Local keyword pre-filter ────────────────────────────────────────────────

# Explicit navigation verbs/phrases (EN + DE). Their presence is a strong signal
# the user wants to *go somewhere*, not just chat about it.
NAV_CUES: tuple[str, ...] = (
    "open ",
    "go to",
    "navigate",
    "take me",
    "show me the",
    "bring me",
    "jump to",
    "switch to",
    "where do i",
    "where can i",
    "öffne",
    "geh zu",
    "geh zur",
    "gehe zu",
    "zeig mir",
    "zeige mir",
    "bring mich",
    "wechsle",
    "spring",
    "navigiere",
    "wo finde ich",
    "wo kann ich",
)

_WORD_RE = re.compile(r"[a-z0-9]+")


class PrefilterResult(BaseModel):
    has_cue: bool
    matches: list[str]  # destination ids, best first


def _destination_matches(text_words: set[str], raw_text: str, dest: NavDestination) -> bool:
    # Multi-word keywords match as substrings; single words match on token
    # boundaries so "ai" doesn't fire inside "maintain".
    label_words = {w for w in _WORD_RE.findall(dest.label.lower())}
    for kw in [*dest.keywords, dest.label.lower(), dest.id.replace(".", " ")]:
        kw = kw.strip().lower()
        if not kw:
            continue
        if " " in kw or "." in kw:
            if kw.replace(".", " ") in raw_text:
                return True
        elif kw in text_words:
            return True
    return bool(label_words & text_words)


def prefilter(message: str, destinations: list[NavDestination]) -> PrefilterResult:
    raw = message.lower()
    words = set(_WORD_RE.findall(raw))
    has_cue = any(cue in raw for cue in NAV_CUES)
    matches = [d.id for d in destinations if _destination_matches(words, raw, d)]
    return PrefilterResult(has_cue=has_cue, matches=matches)


# ── LLM classifier ──────────────────────────────────────────────────────────

ROUTING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["intent", "targets", "confidence"],
    "properties": {
        "intent": {"enum": ["chat", "navigate", "both"]},
        "targets": {
            "type": "array",
            "maxItems": 3,
            "items": {"type": "string"},
            "description": "Destination ids from the provided list, best match first.",
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
}

_ROUTING_SYSTEM_PROMPT = """\
You are the navigation-intent classifier for MATE, a process-mining platform.
Given a single user chat message, decide whether the user wants to NAVIGATE to a
module or page, just CHAT, or BOTH.

Rules:
- "chat": a question/answer with no intent to move somewhere.
- "navigate": the user clearly wants to open/go to a specific module or page.
- "both": the message is a question AND implies a place to work on it.
- Only use destination ids from the list below. Never invent ids.
- If nothing fits, return intent="chat", targets=[], confidence below 0.5.
- "targets" lists at most 3 ids, the best match first.
- "confidence" is your certainty (0-1) that navigation is genuinely wanted.

Available destinations:
"""


def _coerce_routing(obj: Any, valid_ids: set[str]) -> dict[str, Any]:
    """Best-effort validation of the model's raw JSON against our schema."""
    if not isinstance(obj, dict):
        raise GuidanceError("Classifier returned a non-object response.")
    intent = str(obj.get("intent", "chat")).lower()
    if intent not in ("chat", "navigate", "both"):
        intent = "chat"
    raw_targets = obj.get("targets")
    targets: list[str] = []
    if isinstance(raw_targets, list):
        for t in raw_targets:
            tid = str(t)
            if tid in valid_ids and tid not in targets:
                targets.append(tid)
            if len(targets) >= 3:
                break
    try:
        confidence = float(obj.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))
    return {"intent": intent, "targets": targets, "confidence": confidence}


async def classify_intent(
    cfg: AiConfigPayload, *, message: str, destinations: list[NavDestination]
) -> dict[str, Any]:
    """Run the LLM classifier on the (cheaper) classifier model."""
    # Use the classifier model when set; keep the user's saved system prompt out
    # of the classification so it can't skew the routing decision.
    classifier_cfg = cfg.model_copy(
        update={
            "selected_model": cfg.classifier_model or cfg.selected_model,
            "system_prompt": "",
        }
    )
    system_prompt = _ROUTING_SYSTEM_PROMPT + build_destination_catalog(destinations)
    raw = await structured_completion(
        classifier_cfg,
        system_prompt=system_prompt,
        payload={"message": message},
        schema=ROUTING_SCHEMA,
        tool_name="route_intent",
        user_prefix="Classify this user message:",
    )
    return _coerce_routing(raw, {d.id for d in destinations})


# ── Resolution ──────────────────────────────────────────────────────────────


def resolve_targets(
    intent: str,
    target_ids: list[str],
    confidence: float,
    destinations: list[NavDestination],
    log_id: str | None,
    *,
    threshold: float = NAV_CONFIDENCE_THRESHOLD,
) -> list[NavTarget]:
    """Turn classifier output into concrete clickable targets."""
    if intent == "chat" or confidence < threshold:
        return []
    by_id = {d.id: d for d in destinations}
    out: list[NavTarget] = []
    for tid in target_ids:
        d = by_id.get(tid)
        if d is None:
            continue
        if d.requires_log:
            if log_id:
                href = d.href_template.format(log_id=log_id)
                out.append(
                    NavTarget(
                        id=d.id,
                        label=d.label,
                        kind=d.kind,
                        href=href,
                        requires_log=False,
                        available=True,
                    )
                )
            else:
                # No process in context — fall back to the module's config page
                # and flag that a log is needed to reach the actual panel.
                out.append(
                    NavTarget(
                        id=d.id,
                        label=d.label,
                        kind=d.kind,
                        href=f"/modules/{d.id}",
                        requires_log=True,
                        available=False,
                    )
                )
        else:
            out.append(
                NavTarget(
                    id=d.id,
                    label=d.label,
                    kind=d.kind,
                    href=d.href_template,
                    requires_log=False,
                    available=True,
                )
            )
    return out


# ── Orchestration ───────────────────────────────────────────────────────────


async def route_intent(
    cfg: AiConfigPayload,
    *,
    message: str,
    destinations: list[NavDestination],
    log_id: str | None,
) -> RoutingResult:
    """Full pipeline: pre-filter → (maybe) LLM → resolve.

    Never raises on provider failure — navigation is additive, so on any error
    we degrade to a plain chat result with no suggestions.
    """
    message = message.strip()
    if not message:
        return RoutingResult(intent="chat", confidence=1.0, targets=[])

    pf = prefilter(message, destinations)

    # (a) No destination mentioned and no navigation verb → certainly chat.
    if not pf.matches and not pf.has_cue:
        return RoutingResult(intent="chat", confidence=1.0, targets=[])

    # (b) Explicit navigation verb + exactly one matching destination →
    #     unambiguous; skip the LLM entirely.
    if pf.has_cue and len(pf.matches) == 1:
        targets = resolve_targets(
            "navigate", pf.matches, PREFILTER_CONFIDENCE, destinations, log_id
        )
        if targets:
            return RoutingResult(
                intent="navigate", confidence=PREFILTER_CONFIDENCE, targets=targets
            )

    # (c) Ambiguous → ask the model.
    try:
        raw = await classify_intent(cfg, message=message, destinations=destinations)
    except Exception as exc:
        # Navigation is additive — a failed classifier must never break chat.
        log.info("ai.route.classify_failed", error=str(exc))
        return RoutingResult(intent="chat", confidence=0.0, targets=[])

    targets = resolve_targets(
        raw["intent"], raw["targets"], raw["confidence"], destinations, log_id
    )
    return RoutingResult(intent=raw["intent"], confidence=raw["confidence"], targets=targets)
