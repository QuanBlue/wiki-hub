"""Query understanding: folding, ideas and synonyms, and picking the passage to show."""

from __future__ import annotations

from app.modules.search.query import best_snippet, build_concepts, fold, plain_text


def test_fold_drops_accents_and_case_and_keeps_the_length() -> None:
    text = "Đặng Văn_Hùng-Tessel.vn"
    assert fold(text) == "dang van hung tessel vn"
    assert len(fold(text)) == len(text)


def test_filler_words_are_dropped_and_the_rest_become_ideas() -> None:
    ideas = [c.words for c in build_concepts("ip của Tessel Abbott là bao nhiêu?")]
    assert ideas == [("ip",), ("tessel",), ("abbott",)]


def test_vietnamese_and_english_forms_of_one_idea_are_one_concept() -> None:
    (account, cloud, nuti) = build_concepts("tài khoản cloud của nuti")
    assert account.words == ("tai", "khoan")
    assert ("account",) in account.synonyms
    assert "'account'" in account.tsquery()
    assert "'tai':* <-> 'khoan':*" in account.tsquery()
    # "cloud" has a Vietnamese form too, and "nuti" none.
    assert ("dam", "may") in cloud.synonyms
    assert nuti.synonyms == ()

    (english,) = build_concepts("Account")
    assert ("tai", "khoan") in english.synonyms


def test_the_longest_known_phrase_wins_over_a_stopword_inside_it() -> None:
    (database,) = build_concepts("cơ sở dữ liệu")
    assert database.words == ("co", "so", "du", "lieu")
    assert ("database",) in database.synonyms


def test_only_the_users_own_words_may_be_prefixes() -> None:
    (concept,) = build_concepts("nuti")
    assert concept.tsquery() == "('nuti':*)"
    (account,) = build_concepts("account")
    # A synonym must match exactly, or "acc" would drag in every "access".
    assert "'acc')" in account.tsquery() and "'acc':*" not in account.tsquery()
    assert build_concepts("qa")[0].tsquery() == "('qa')"  # too short to be a prefix
    # "ip" also stands for the marker every page with an address carries.
    assert "('ipaddr')" in build_concepts("ip")[0].tsquery()


def test_queries_are_cut_short_and_repeats_removed() -> None:
    assert len(build_concepts(" ".join(f"word{i}" for i in range(30)))) == 8
    assert [c.words for c in build_concepts("nuti nuti NUTI")] == [("nuti",)]
    assert build_concepts("là của") == []
    assert build_concepts("") == []


def test_the_snippet_centres_on_the_rarest_word_not_the_first_one() -> None:
    content = (
        "<p>Cloud " + "filler " * 40 + "end of the cloud section. "
        "Tài khoản của NUTIFOOD_VTS đăng nhập thành công.</p>"
    )
    snippet, found = best_snippet(content, [("cloud", 1.0), ("nuti", 4.0), ("tai khoan", 2.0)])
    assert found
    assert "NUTIFOOD" in snippet and "Tài khoản" in snippet
    assert snippet.startswith("...")


def test_a_snippet_without_any_term_is_the_start_of_the_page() -> None:
    snippet, found = best_snippet("<p>" + "word " * 100 + "</p>", [("zzz", 1.0)])
    assert not found
    assert snippet.startswith("word") and snippet.endswith("...")
    assert best_snippet("", [("a", 1.0)]) == ("", False)
    assert best_snippet("<br>", [("a", 1.0)]) == ("", False)


def test_plain_text_strips_markup_scripts_and_entities() -> None:
    assert plain_text("<script>x()</script><p>a &amp;  b</p>") == "a & b"
