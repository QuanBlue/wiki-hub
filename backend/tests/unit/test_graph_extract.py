"""Finding links and mentions of other pages in a page's text."""

from __future__ import annotations

import uuid

from app.modules.graph.extract import (
    MAX_MENTIONS_PER_PAGE,
    TitledPage,
    TitleIndex,
    copy_key,
    internal_links,
    is_matchable_title,
    title_words,
)

SPACE = uuid.uuid4()
OTHER_SPACE = uuid.uuid4()


def page(title: str, space: uuid.UUID = SPACE) -> TitledPage:
    return TitledPage(id=uuid.uuid4(), space_id=space, title=title)


def mentions(index: TitleIndex, content: str, *, title: str = "Some page") -> list[uuid.UUID]:
    return index.mentions(title, content, page_id=uuid.uuid4(), space_id=SPACE)


def test_internal_links_read_relative_and_absolute_hrefs_once_each() -> None:
    content = (
        '<p><a href="/spaces/DEV/pages/install-k3s">k3s</a> and '
        "<a href='https://wiki.example.com/spaces/OPS/pages/t-ng-h-p?x=1#top'>ops</a> and "
        '<a href="/spaces/DEV/pages/install-k3s">again</a> and '
        '<a href="https://example.com/elsewhere">out</a></p>'
    )
    assert internal_links(content) == [("DEV", "install-k3s"), ("OPS", "t-ng-h-p")]


def test_internal_links_read_markdown_links() -> None:
    content = "See [k3s](/spaces/DEV/pages/install-k3s) and [docs](https://x.io/spaces/A/pages/b)."
    assert internal_links(content) == [("DEV", "install-k3s"), ("A", "b")]


def test_internal_links_decode_percent_encoding() -> None:
    assert internal_links('<a href="/spaces/DEV/pages/caf%C3%A9">x</a>') == [("DEV", "café")]


def test_titles_are_folded_like_search() -> None:
    assert title_words("Hướng dẫn cài đặt VPN_SSL") == ("huong", "dan", "cai", "dat", "vpn", "ssl")


def test_generic_short_and_filler_titles_are_not_matchable() -> None:
    for title in ("Overview", "Tổng quan", "FAQ", "AM", "PMO", "Kafka", "của và", "2024"):
        assert not is_matchable_title(title_words(title)), title
    for title in ("Grafana", "Prometheus", "Leave request form", "Đơn vị hỗ trợ"):
        assert is_matchable_title(title_words(title)), title


def test_a_mention_ignores_accents_and_case() -> None:
    target = page("Mẫu đơn nghỉ phép")
    index = TitleIndex([target])
    assert mentions(index, "<p>Điền MAU DON nghi phep rồi gửi.</p>") == [target.id]


def test_a_mention_needs_whole_words() -> None:
    target = page("Prometheus")
    index = TitleIndex([target])
    assert mentions(index, "<p>prometheusexporter is not it</p>") == []
    assert mentions(index, "<p>see prometheus.</p>") == [target.id]


def test_the_longest_title_wins() -> None:
    short = page("Leave request")
    long = page("Leave request form")
    index = TitleIndex([short, long])
    assert mentions(index, "<p>Fill in the leave request form.</p>") == [long.id]


def test_markup_is_not_text() -> None:
    target = page("Prometheus")
    index = TitleIndex([target])
    assert mentions(index, '<img alt="x" src="/prometheus.png">') == []


def test_a_title_shared_across_spaces_names_the_one_in_the_same_space() -> None:
    here = page("Lesson learned", SPACE)
    there = page("Lesson learned", OTHER_SPACE)
    index = TitleIndex([here, there])
    assert mentions(index, "<p>see lesson learned</p>") == [here.id]


def test_copies_in_the_same_space_name_nothing() -> None:
    index = TitleIndex([page("Đơn vị hỗ trợ"), page("Đơn vị hỗ trợ")])
    assert mentions(index, "<p>liên hệ đơn vị hỗ trợ</p>") == []


def test_a_page_never_mentions_itself_or_its_own_title() -> None:
    me = page("Install k3s")
    index = TitleIndex([me])
    assert index.mentions("Install k3s", "<p>install k3s</p>", page_id=me.id, space_id=SPACE) == []


def test_mentions_are_capped() -> None:
    targets = [page(f"Service number {i}") for i in range(MAX_MENTIONS_PER_PAGE + 10)]
    index = TitleIndex(targets)
    text = " ".join(f"service number {i}." for i in range(len(targets)))
    assert len(mentions(index, f"<p>{text}</p>")) == MAX_MENTIONS_PER_PAGE


def test_copies_share_a_copy_key() -> None:
    assert copy_key("Lesson_Learned (1)") == copy_key("Lesson Learned") == ("lesson", "learned")
    assert copy_key("Release 2") != copy_key("Release")
