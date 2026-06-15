"""Intent-based navigation routing (``mate.api.ai_nav``).

Pure-logic coverage: keyword pre-filter, target resolution, classifier-output
coercion, and the full ``route_intent`` orchestration with a stubbed LLM.
"""

from __future__ import annotations

import asyncio

from mate.api import ai_nav
from mate.api.ai_config import AiConfigPayload
from mate.api.ai_nav import (
    NavDestination,
    _coerce_routing,
    _derive_keywords,
    prefilter,
    resolve_targets,
    route_intent,
)

# A compact, deterministic registry for the unit tests.
PERF = NavDestination(
    id="performance",
    label="Performance",
    kind="module",
    href_template="/processes/{log_id}/modules/performance",
    requires_log=True,
    keywords=["performance", "bottleneck", "cycle time"],
    description="Throughput and bottlenecks.",
)
SETTINGS_AI = NavDestination(
    id="settings.ai",
    label="AI settings",
    kind="page",
    href_template="/settings/ai",
    requires_log=False,
    keywords=["ai settings", "api key", "provider"],
    description="Configure the AI provider.",
)
DESTS = [PERF, SETTINGS_AI]


def _cfg() -> AiConfigPayload:
    return AiConfigPayload(
        selected_provider="openai",
        selected_model="gpt-x",
        openai={"api_key": "sk-test"},
    )


# ── pre-filter ───────────────────────────────────────────────────────────────


def test_prefilter_pure_chat_has_no_cue_and_no_match() -> None:
    pf = prefilter("tell me a joke about cats", DESTS)
    assert pf.has_cue is False
    assert pf.matches == []


def test_prefilter_detects_navigation_verb_and_single_match() -> None:
    pf = prefilter("open the performance module", DESTS)
    assert pf.has_cue is True
    assert pf.matches == ["performance"]


def test_prefilter_matches_multiword_keyword_as_substring() -> None:
    pf = prefilter("where can i set my api key", DESTS)
    assert pf.has_cue is True  # "where can i"
    assert "settings.ai" in pf.matches


def test_prefilter_keyword_without_cue_still_matches_but_no_cue() -> None:
    # A bare mention is a match but not an explicit navigation request.
    pf = prefilter("the cycle time looks high", DESTS)
    assert pf.has_cue is False
    assert pf.matches == ["performance"]


# ── resolution ───────────────────────────────────────────────────────────────


def test_resolve_module_panel_with_log_context() -> None:
    out = resolve_targets("navigate", ["performance"], 0.9, DESTS, log_id="L1")
    assert len(out) == 1
    assert out[0].href == "/processes/L1/modules/performance"
    assert out[0].available is True
    assert out[0].requires_log is False


def test_resolve_module_panel_without_log_falls_back_to_config() -> None:
    out = resolve_targets("navigate", ["performance"], 0.9, DESTS, log_id=None)
    assert out[0].href == "/modules/performance"
    assert out[0].available is False
    assert out[0].requires_log is True


def test_resolve_page_ignores_log() -> None:
    out = resolve_targets("navigate", ["settings.ai"], 0.9, DESTS, log_id=None)
    assert out[0].href == "/settings/ai"
    assert out[0].available is True


def test_resolve_drops_below_confidence_threshold() -> None:
    assert resolve_targets("navigate", ["performance"], 0.5, DESTS, log_id="L1") == []


def test_resolve_chat_intent_yields_nothing() -> None:
    assert resolve_targets("chat", ["performance"], 0.99, DESTS, log_id="L1") == []


def test_resolve_unknown_id_is_skipped() -> None:
    assert resolve_targets("navigate", ["does_not_exist"], 0.9, DESTS, log_id="L1") == []


# ── classifier-output coercion ───────────────────────────────────────────────


def test_coerce_filters_to_valid_ids_and_clamps_confidence() -> None:
    out = _coerce_routing(
        {"intent": "navigate", "targets": ["performance", "ghost"], "confidence": 1.7},
        {"performance", "settings.ai"},
    )
    assert out == {"intent": "navigate", "targets": ["performance"], "confidence": 1.0}


def test_coerce_defaults_garbage_to_chat() -> None:
    out = _coerce_routing({"intent": "weird", "confidence": "n/a"}, {"performance"})
    assert out == {"intent": "chat", "targets": [], "confidence": 0.0}


# ── keyword derivation ───────────────────────────────────────────────────────


def test_derive_keywords_from_name_and_provides() -> None:
    kws = _derive_keywords("Performance", "Throughput and bottlenecks.", ["perf.kpis"])
    assert "performance" in kws
    assert "kpis" in kws
    assert all(len(k) >= 3 for k in kws)


# ── full orchestration (LLM stubbed) ─────────────────────────────────────────


def test_route_intent_classifies_when_no_fast_path(monkeypatch) -> None:
    # No nav verb + no keyword match no longer short-circuits to chat: we always
    # consult the classifier so non-English / paraphrased intent isn't missed.
    called = {"n": 0}

    async def _fake(cfg, *, message, destinations):
        called["n"] += 1
        return {"intent": "chat", "targets": [], "confidence": 0.1}

    monkeypatch.setattr(ai_nav, "classify_intent", _fake)
    res = asyncio.run(
        route_intent(_cfg(), message="tell me a joke", destinations=DESTS, log_id=None)
    )
    assert called["n"] == 1
    assert res.intent == "chat"
    assert res.targets == []


def test_route_intent_routes_non_english_intent_via_llm(monkeypatch) -> None:
    # The exact regression: a German message mentioning "Complexität" has no
    # English keyword match and no nav verb, so it must reach the classifier.
    called = {"n": 0}

    async def _fake(cfg, *, message, destinations):
        called["n"] += 1
        return {"intent": "both", "targets": ["performance"], "confidence": 0.85}

    monkeypatch.setattr(ai_nav, "classify_intent", _fake)
    res = asyncio.run(
        route_intent(
            _cfg(),
            message="Ich möchte mehr über die Complexität erfahren",
            destinations=DESTS,
            log_id="L1",
        )
    )
    assert called["n"] == 1
    assert res.intent == "both"
    assert res.targets[0].id == "performance"


def test_route_intent_skips_llm_for_unambiguous_nav(monkeypatch) -> None:
    def _boom(*a, **k):
        raise AssertionError("classifier must not be called for unambiguous nav")

    monkeypatch.setattr(ai_nav, "classify_intent", _boom)
    res = asyncio.run(
        route_intent(
            _cfg(), message="open the performance module", destinations=DESTS, log_id="L1"
        )
    )
    assert res.intent == "navigate"
    assert [t.id for t in res.targets] == ["performance"]
    assert res.targets[0].href == "/processes/L1/modules/performance"


def test_route_intent_calls_llm_for_ambiguous_message(monkeypatch) -> None:
    called = {"n": 0}

    async def _fake(cfg, *, message, destinations):
        called["n"] += 1
        return {"intent": "both", "targets": ["performance"], "confidence": 0.9}

    monkeypatch.setattr(ai_nav, "classify_intent", _fake)
    res = asyncio.run(
        route_intent(
            _cfg(), message="the cycle time looks high", destinations=DESTS, log_id="L1"
        )
    )
    assert called["n"] == 1
    assert res.intent == "both"
    assert res.targets[0].href == "/processes/L1/modules/performance"


def test_route_intent_swallows_classifier_errors(monkeypatch) -> None:
    async def _fail(cfg, *, message, destinations):
        raise RuntimeError("provider down")

    monkeypatch.setattr(ai_nav, "classify_intent", _fail)
    res = asyncio.run(
        route_intent(
            _cfg(), message="the cycle time looks high", destinations=DESTS, log_id="L1"
        )
    )
    assert res.intent == "chat"
    assert res.targets == []
