"""Multiple authors / papers in a module manifest.

A manifest may declare up to 20 `authors` and up to 20 `papers`. The legacy
singular `author`/`author_url`/`paper_url` fields keep working: they are folded
into the plural lists as the FIRST entry (`Manifest._merge_author_credits`), so
consumers can read one canonical list regardless of which form a manifest uses.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from mate.sdk.errors import ModuleManifestError
from mate.sdk.manifest import MAX_AUTHORS, MAX_PAPERS, Manifest

_MODULES_DIR = Path(__file__).resolve().parents[3] / "modules"


def _base(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "id": "demo",
        "name": "Demo",
        "version": "1.0.0",
        "category": "advanced",
    }
    data.update(overrides)
    return data


# ── backward compatibility: singular → plural merge ─────────────────────────


def test_singular_author_and_paper_fold_into_the_plural_lists() -> None:
    m = Manifest.model_validate(
        _base(
            author="Augusto et al. (2022)",
            author_url="https://example.com/repo",
            paper_url="https://doi.org/10.1000/xyz",
        )
    )
    # Folded in as the first (and only) entry of each list.
    assert [(a.name, a.url) for a in m.authors] == [
        ("Augusto et al. (2022)", "https://example.com/repo")
    ]
    assert [(p.title, p.url) for p in m.papers] == [(None, "https://doi.org/10.1000/xyz")]
    # Singular fields are untouched so old code that reads them still works.
    assert m.author == "Augusto et al. (2022)"
    assert m.paper_url == "https://doi.org/10.1000/xyz"


def test_author_url_without_a_name_is_ignored() -> None:
    # An author needs a name; a bare author_url can't build one.
    m = Manifest.model_validate(_base(author_url="https://example.com"))
    assert m.authors == []


def test_singular_leads_and_plural_entries_follow() -> None:
    m = Manifest.model_validate(
        _base(
            author="Lead Author",
            author_url="https://lead.example",
            authors=[{"name": "Second Author", "url": None}, {"name": "Third Author"}],
            paper_url="https://doi.org/lead",
            papers=[{"title": "Follow-up", "url": "https://doi.org/follow"}],
        )
    )
    assert [a.name for a in m.authors] == ["Lead Author", "Second Author", "Third Author"]
    assert [p.url for p in m.papers] == ["https://doi.org/lead", "https://doi.org/follow"]


def test_singular_matching_an_existing_plural_entry_is_not_duplicated() -> None:
    m = Manifest.model_validate(
        _base(
            author="Same Name",
            authors=[{"name": "Same Name", "url": "https://x"}],
            paper_url="https://doi.org/same",
            papers=[{"title": "Paper", "url": "https://doi.org/same"}],
        )
    )
    assert [a.name for a in m.authors] == ["Same Name"]
    assert [p.url for p in m.papers] == ["https://doi.org/same"]


# ── plural-only + shapes ────────────────────────────────────────────────────


def test_plural_only_authors_and_papers() -> None:
    m = Manifest.model_validate(
        _base(
            authors=[{"name": "A"}, {"name": "B", "url": "https://b"}],
            papers=[{"title": "P1", "url": "https://p1"}, {"url": "https://p2"}],
        )
    )
    assert [(a.name, a.url) for a in m.authors] == [("A", None), ("B", "https://b")]
    assert [(p.title, p.url) for p in m.papers] == [("P1", "https://p1"), (None, "https://p2")]


def test_paper_requires_a_url() -> None:
    with pytest.raises(ValidationError):
        Manifest.model_validate(_base(papers=[{"title": "No URL"}]))


# ── max-20 caps ─────────────────────────────────────────────────────────────


def test_exactly_20_declared_authors_and_papers_is_allowed() -> None:
    m = Manifest.model_validate(
        _base(
            authors=[{"name": f"A{i}"} for i in range(MAX_AUTHORS)],
            papers=[{"url": f"https://p/{i}"} for i in range(MAX_PAPERS)],
        )
    )
    assert len(m.authors) == MAX_AUTHORS == 20
    assert len(m.papers) == MAX_PAPERS == 20


def test_more_than_20_declared_authors_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Manifest.model_validate(_base(authors=[{"name": f"A{i}"} for i in range(21)]))


def test_more_than_20_declared_papers_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Manifest.model_validate(_base(papers=[{"url": f"https://p/{i}"} for i in range(21)]))


def test_singular_pushing_the_merged_list_past_20_fails_loud() -> None:
    # 20 declared authors + a singular author (new name) = 21 -> rejected.
    with pytest.raises(ModuleManifestError):
        Manifest.model_validate(
            _base(
                author="Extra Author",
                authors=[{"name": f"A{i}"} for i in range(MAX_AUTHORS)],
            )
        )
    with pytest.raises(ModuleManifestError):
        Manifest.model_validate(
            _base(
                paper_url="https://doi.org/extra",
                papers=[{"url": f"https://p/{i}"} for i in range(MAX_PAPERS)],
            )
        )


# ── existing bundled manifests still load ───────────────────────────────────


def test_bundled_complexity_manifest_still_loads_and_merges() -> None:
    m = Manifest.load_yaml(_MODULES_DIR / "complexity" / "manifest.yaml")
    assert m.authors[0].name == "Augusto et al. (2022)"
    assert m.authors[0].url == "https://github.com/brusayannick/Process-Mining-SeminarProtoype"
    assert m.papers[0].url == "https://doi.org/10.1016/j.ins.2022.03.072"
    assert m.papers[0].title is None
