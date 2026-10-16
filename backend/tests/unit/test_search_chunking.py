"""Passage splitting, query tokenising and rank fusion for page search."""

from __future__ import annotations

import pytest

from app.modules.search.chunking import HARD_LIMIT, chunk_page
from app.modules.search.service import _fuse, _passage_snippet, query_tokens


def test_chunks_lead_with_title_and_nearest_heading() -> None:
    markup = (
        "<h1>Overview</h1><p>Intro text.</p><h2>Tessel Abbott</h2><p>IP: 10.0.0.5. Contact ops.</p>"
    )
    chunks = chunk_page("Network", markup, max_chunks=10)
    assert chunks[0].startswith("Network - Overview\n")
    assert any(c.startswith("Network - Tessel Abbott\n") and "10.0.0.5" in c for c in chunks)


def test_page_without_body_is_still_findable_by_title() -> None:
    assert chunk_page("Only a title", "", max_chunks=5) == ["Only a title"]
    assert chunk_page("", "<p></p>", max_chunks=5) == []


def test_long_blocks_are_split_and_capped() -> None:
    sentence = "This is a sentence about servers. "
    chunks = chunk_page("Long", "<p>" + sentence * 400 + "</p>", max_chunks=3)
    assert len(chunks) == 3
    assert all(len(c) < HARD_LIMIT + 50 for c in chunks)
    unbroken = chunk_page("Blob", "<p>" + "x" * (HARD_LIMIT * 2 + 10) + "</p>", max_chunks=10)
    assert len(unbroken) == 3


def test_scripts_and_markup_never_reach_the_embedding() -> None:
    chunks = chunk_page("T", "<script>secret()</script><p>a &amp; b</p>", max_chunks=5)
    assert chunks == ["T\na & b"]


def test_query_tokens_drop_filler_and_fold_accents() -> None:
    assert query_tokens("ip của Tessel Abbott là bao nhiêu?") == ["ip", "tessel", "abbott"]
    assert query_tokens("Đặng  Văn   Hùng") == ["dang", "van", "hung"]
    assert query_tokens("what is the ip of Tessel") == ["ip", "tessel"]
    assert query_tokens("là của") == []
    assert query_tokens("v2 7 a") == ["v2", "7"]
    assert query_tokens("ip ip IP") == ["ip"]


def test_fusion_prefers_pages_ranked_by_several_methods() -> None:
    assert _fuse(["a", "b", "c"], ["c", "d"])[:2] == ["c", "a"]
    assert _fuse([], []) == []
    assert _fuse(["a"], []) == ["a"]


def test_passage_snippet_drops_the_title_lead() -> None:
    assert _passage_snippet("Title - Heading\nthe  matching\ntext") == "the matching text"
    assert _passage_snippet("x" * 200).endswith("...")


async def test_a_self_hosted_model_that_was_idle_is_waited_for_but_other_sources_time_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import asyncio
    from dataclasses import replace

    from app.modules.ai.config import AIConfig
    from app.modules.ai.tuning import Tuning
    from app.modules.search import service

    async def slow(config, texts):
        await asyncio.sleep(0.2)  # the model is being loaded again
        return [[0.1, 0.2]]

    class NoCache:
        async def get(self, key):
            return None

        async def set(self, key, value, ex=None):
            return None

    monkeypatch.setattr(service, "embed", slow)
    monkeypatch.setattr(service, "get_redis", lambda: NoCache())
    short = Tuning(query_timeout_seconds=0.05)
    base = AIConfig(True, "http://g/v1", "k", "chat", "m", tuning=short)

    # The limit that protects an ordinary gateway still applies to it...
    assert await service._embed_query(replace(base, embedding_source="custom"), "q") is None
    # ...but a local Ollama gets time to load its model, so the first search is not keyword-only.
    assert await service._embed_query(replace(base, embedding_source="ollama"), "q") == [0.1, 0.2]
