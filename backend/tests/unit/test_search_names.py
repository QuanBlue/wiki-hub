"""Matching a typed name against a stored one (``app.modules.search.names``)."""

from __future__ import annotations

import pytest

from app.modules.search.names import (
    CONTAINS,
    EXACT,
    FUZZY,
    PREFIX,
    WORD_PREFIX,
    WORDS_INSIDE,
    best_name_score,
    compact,
    mentions_all_words,
    name_score,
    name_words,
)


def test_compact_squashes_breaks_accents_and_capitals() -> None:
    assert compact("DMS 1.0") == "dms10"
    assert compact("dms_1-0") == "dms10"
    assert compact("Nguyễn Văn Quân") == "nguyenvanquan"
    assert compact("Đặng") == "dang"
    assert compact("") == ""
    assert name_words("Nguyễn Văn-Quân") == ["nguyen", "van", "quan"]


@pytest.mark.parametrize("typed", ["dms1", "DMs1", "Dms1", "dms 1", "dms_1"])
def test_the_start_of_a_name_typed_any_way_is_a_prefix(typed: str) -> None:
    assert PREFIX <= name_score(typed, "dms1.0") < PREFIX + 5.01


def test_the_kinds_of_match_rank_in_order() -> None:
    assert name_score("dms1.0", "DMS 1.0") == EXACT
    assert WORD_PREFIX <= name_score("quan nguyen", "Nguyễn Văn Quân") < PREFIX
    assert CONTAINS <= name_score("ops", "DevOps") < WORD_PREFIX
    assert WORDS_INSIDE <= name_score("ev ps", "DevOps") < CONTAINS
    assert 0 < name_score("dsm1", "dms1") <= FUZZY
    assert 0 < name_score("vofice", "voffice") <= FUZZY


def test_a_shorter_name_ranks_above_a_longer_one_with_the_same_start() -> None:
    assert name_score("dms1", "dms1.0") > name_score("dms1", "dms1.0 archive")


def test_unrelated_or_too_short_queries_do_not_match() -> None:
    assert name_score("x", "xenon") == 0
    assert name_score("x", "x") == EXACT
    assert name_score("", "anything") == 0
    assert name_score("abc", "") == 0
    assert name_score("billing", "dms1.0") == 0
    # Three letters is too few to call one a slip of the keyboard for another.
    assert name_score("abz", "abc") == 0


def test_the_best_of_several_names_counts() -> None:
    assert best_name_score("quannv", "quannv", "Nguyễn Văn Quân") == EXACT
    assert best_name_score("quân", None, "Nguyễn Văn Quân") >= WORD_PREFIX
    assert best_name_score("anything") == 0


def test_a_description_must_hold_every_typed_word() -> None:
    assert mentions_all_words("dms migration", "Notes on the DMS 1.0 migration")
    assert not mentions_all_words("dms billing", "Notes on the DMS 1.0 migration")
    assert not mentions_all_words("a", "a b c")
    assert not mentions_all_words("dms", "")
