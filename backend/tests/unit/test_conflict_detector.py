"""Unit tests for the AI contradiction / conflict detector in Content Health."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.modules.ai.service import (
    _CONFLICT_PAGE_CHARS,
    _CONFLICT_SYSTEM_PROMPT,
    _conflict_verdict,
)
from app.schemas.graph import (
    ConflictCheckRead,
    ConflictCheckRequest,
    ConflictPair,
    HealthPage,
    SpaceHealthRead,
)


def _page(title: str, slug: str) -> HealthPage:
    return HealthPage(
        id=uuid.uuid4(),
        title=title,
        slug=slug,
        space_key="OPS",
        space_name="Operations",
        updated_at=datetime.now(UTC),
    )


def test_conflict_system_prompt_interpolates_titles_and_language() -> None:
    prompt = _CONFLICT_SYSTEM_PROMPT.format(
        language="Vietnamese",
        title_a="Cấu hình VPN & Cổng mạng",
        title_b="Danh sách Firewall Port",
    )
    assert "Vietnamese" in prompt
    assert "Cấu hình VPN & Cổng mạng" in prompt
    assert "Danh sách Firewall Port" in prompt
    assert "[CONFLICT_FOUND]" in prompt
    assert "[NO_CONFLICT]" in prompt
    assert "network ports" in prompt.lower() or "cổng mạng" in prompt.lower()
    assert _CONFLICT_PAGE_CHARS >= 5000


def test_conflict_schemas() -> None:
    p1 = _page("Page 1", "page-1")
    p2 = _page("Page 2", "page-2")

    pair = ConflictPair(
        id=f"{p1.id}:{p2.id}",
        page_a=p1,
        page_b=p2,
        relation="similar",
        similarity=0.88,
    )
    assert pair.relation == "similar"
    assert pair.similarity == 0.88

    health = SpaceHealthRead(
        stale_days=180,
        recent_days=90,
        stale=[],
        stale_total=0,
        broken_links=[],
        broken_total=0,
        orphans=[],
        orphans_total=0,
        duplicates=[],
        duplicates_total=0,
        conflicts=[pair],
        conflicts_total=1,
        semantic=True,
    )
    assert health.conflicts_total == 1
    assert health.conflicts[0].id == f"{p1.id}:{p2.id}"

    req = ConflictCheckRequest(
        page_a_slug="page-1",
        page_b_slug="page-2",
        locale="vi",
    )
    assert req.page_b_space_key is None
    assert req.locale == "vi"

    read = ConflictCheckRead(
        has_conflict=True,
        result="- **Port mạng**: Cổng 8080 vs 8443.",
        compared=[p1, p2],
        cached=False,
    )
    assert read.has_conflict is True
    assert "Port mạng" in read.result


@pytest.mark.parametrize(
    ("reply", "verdict", "text"),
    [
        ("[NO_CONFLICT]\nThe pages agree.", "consistent", "The pages agree."),
        ("**[NO_CONFLICT]**\nThe pages agree.", "consistent", "The pages agree."),
        ("`[NO_CONFLICT]` The pages agree.", "consistent", "The pages agree."),
        ("[CONFLICT_FOUND]\n- **Port**: 8443 vs 9443.", "conflict", "- **Port**: 8443 vs 9443."),
        (
            "**[CONFLICT_FOUND]**\n\n- **Port**: 8443 vs 9443.",
            "conflict",
            "- **Port**: 8443 vs 9443.",
        ),
        ("[DUPLICATE_CONTENT]\nThe pages repeat.", "duplicate", "The pages repeat."),
        ("**[DUPLICATE_CONTENT]**\n\nSame.", "duplicate", "Same."),
        # No tag at all: shown as a finding rather than dropped as "consistent".
        ("- **Port**: 8443 vs 9443.", "conflict", "- **Port**: 8443 vs 9443."),
    ],
)
def test_conflict_verdict_reads_the_tag_wherever_the_model_puts_it(
    reply: str, verdict: str, text: str
) -> None:
    assert _conflict_verdict(reply) == (verdict, text)
