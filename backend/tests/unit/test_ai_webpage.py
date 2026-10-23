"""Reading web pages the search found: only public addresses, bounded, and only the useful part."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.modules.ai import webpage, websearch
from app.modules.ai.webpage import (
    Blocked,
    best_excerpt,
    check,
    fetch_text,
    next_part,
    readable_text,
    split_excerpt,
)
from app.modules.ai.websearch import WebResult, read_pages

PUBLIC = "93.184.216.34"


def resolving(monkeypatch: pytest.MonkeyPatch, table: dict[str, list[str]]) -> None:
    async def resolve(host: str, port: int) -> list[str]:
        if host not in table:
            raise OSError("no such host")
        return table[host]

    monkeypatch.setattr(webpage, "_resolve", resolve)


def serving(monkeypatch: pytest.MonkeyPatch, handler) -> list[httpx.Request]:
    seen: list[httpx.Request] = []
    real = httpx.AsyncClient

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(
        webpage.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(respond), **kw),
    )
    return seen


def html_page(
    body: str, status: int = 200, kind: str = "text/html; charset=utf-8"
) -> httpx.Response:
    return httpx.Response(status, headers={"content-type": kind}, content=body.encode())


# ---------------------------------------------------------------- which addresses may be read


@pytest.mark.parametrize(
    ("url", "why"),
    [
        ("ftp://example.com/file", "scheme"),
        ("file:///etc/passwd", "scheme"),
        ("http://user:secret@example.com/", "credentials"),
        ("http:///nohost", "host"),
        ("http://example.com:8080/", "port"),
        ("http://example.com:notaport/", "port"),
    ],
)
async def test_an_address_of_the_wrong_kind_is_refused(
    monkeypatch: pytest.MonkeyPatch, url: str, why: str
) -> None:
    resolving(monkeypatch, {"example.com": [PUBLIC]})

    with pytest.raises(Blocked, match=why):
        await check(url)


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "192.168.1.1",
        "172.16.0.9",
        "169.254.169.254",
        "::1",
        "fe80::1",
        "0.0.0.0",
    ],
)
async def test_a_host_that_resolves_to_the_machine_or_a_private_network_is_refused(
    monkeypatch: pytest.MonkeyPatch, address: str
) -> None:
    resolving(monkeypatch, {"evil.example": [address]})

    with pytest.raises(Blocked, match="not public"):
        await check("https://evil.example/")


async def test_one_private_address_among_public_ones_is_enough_to_refuse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolving(monkeypatch, {"mixed.example": [PUBLIC, "10.0.0.5"]})

    with pytest.raises(Blocked):
        await check("https://mixed.example/")


async def test_a_host_that_does_not_resolve_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    resolving(monkeypatch, {})

    with pytest.raises(Blocked, match="unresolvable"):
        await check("https://nowhere.example/")


async def test_a_public_host_gives_the_address_to_connect_to(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolving(monkeypatch, {"example.com": [PUBLIC]})

    assert await check("https://example.com/a") == ("https", "example.com", 443, PUBLIC)
    assert await check("http://example.com:80/a") == ("http", "example.com", 80, PUBLIC)


def test_the_request_goes_to_the_address_that_was_checked() -> None:
    assert webpage._pinned("https://example.com/a?b=1", "https", 443, PUBLIC) == (
        f"https://{PUBLIC}/a?b=1"
    )
    assert webpage._pinned("http://example.com:80/", "http", 80, PUBLIC) == f"http://{PUBLIC}/"
    assert webpage._pinned("https://example.com/", "https", 443, "2606:2800:220:1::1") == (
        "https://[2606:2800:220:1::1]/"
    )
    assert webpage._pinned("http://example.com/", "http", 8080, PUBLIC) == f"http://{PUBLIC}:8080/"


def test_something_that_is_not_an_address_is_not_public() -> None:
    assert webpage._public("not-an-ip") is False
    assert webpage._public("fe80::1%eth0") is False


# ---------------------------------------------------------------- fetching


async def test_a_page_is_fetched_from_the_checked_address_with_its_own_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolving(monkeypatch, {"weather.example": [PUBLIC]})
    seen = serving(monkeypatch, lambda request: html_page("<p>It is <b>31°</b> in Cam Ranh</p>"))

    text = await fetch_text("https://weather.example/cam-ranh")

    assert text == "It is 31° in Cam Ranh"
    assert seen[0].url.host == PUBLIC and seen[0].headers["host"] == "weather.example"
    assert seen[0].extensions["sni_hostname"] == "weather.example"


async def test_a_redirect_is_followed_when_it_stays_public(monkeypatch: pytest.MonkeyPatch) -> None:
    resolving(monkeypatch, {"a.example": [PUBLIC], "b.example": ["93.184.216.35"]})

    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "a.example":
            return httpx.Response(302, headers={"location": "https://b.example/final"})
        return html_page("<p>arrived</p>")

    serving(monkeypatch, handler)

    assert await fetch_text("https://a.example/") == "arrived"


async def test_a_redirect_to_a_private_address_is_not_followed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolving(monkeypatch, {"a.example": [PUBLIC], "internal.example": ["10.0.0.5"]})

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://internal.example/admin"})

    seen = serving(monkeypatch, handler)

    assert await fetch_text("https://a.example/") == ""
    assert [r.headers["host"] for r in seen] == ["a.example"]  # the private one was never asked


async def test_redirects_that_never_end_give_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    resolving(monkeypatch, {"a.example": [PUBLIC]})
    seen = serving(monkeypatch, lambda request: httpx.Response(302, headers={"location": "/again"}))

    assert await fetch_text("https://a.example/") == ""
    assert len(seen) == webpage._MAX_REDIRECTS + 1


async def test_a_redirect_with_no_target_gives_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    resolving(monkeypatch, {"a.example": [PUBLIC]})
    serving(monkeypatch, lambda request: httpx.Response(302))

    assert await fetch_text("https://a.example/") == ""


async def test_the_real_resolver_answers_for_a_literal_address() -> None:
    assert await webpage._resolve("127.0.0.1", 80) == ["127.0.0.1"]


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(404, content=b"gone"),
        httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF"),
        httpx.Response(200, headers={"content-type": "image/png"}, content=b"\x89PNG"),
    ],
)
async def test_a_page_that_is_missing_or_not_text_gives_nothing(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response
) -> None:
    resolving(monkeypatch, {"a.example": [PUBLIC]})
    serving(monkeypatch, lambda request: response)

    assert await fetch_text("https://a.example/") == ""


async def test_a_page_is_read_only_up_to_a_size(monkeypatch: pytest.MonkeyPatch) -> None:
    resolving(monkeypatch, {"a.example": [PUBLIC]})
    monkeypatch.setattr(webpage, "_MAX_BYTES", 1000)
    serving(monkeypatch, lambda request: html_page("<p>" + "word " * 5000 + "</p>"))

    text = await fetch_text("https://a.example/")

    assert 0 < len(text) < 1500


async def test_a_connection_that_fails_or_an_address_that_is_refused_gives_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolving(monkeypatch, {"a.example": [PUBLIC], "internal.example": ["127.0.0.1"]})

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    serving(monkeypatch, refuse)

    assert await fetch_text("https://a.example/") == ""
    assert await fetch_text("https://internal.example/") == ""


# ---------------------------------------------------------------- what is kept of a page


def test_the_words_of_a_page_have_no_markup_scripts_or_menus() -> None:
    markup = (
        "<html><head><title>x</title></head><nav>Home About</nav><!-- note -->"
        "<script>track()</script><style>p{}</style><p>Temp &amp; wind:  31°</p>"
        "<footer>Cookies</footer></html>"
    )

    assert readable_text(markup) == "Temp & wind: 31°"


def test_a_short_page_is_kept_whole() -> None:
    assert best_excerpt("short text", "anything") == "short text"


def test_a_long_page_is_cut_to_the_part_with_the_facts() -> None:
    menu = "Home Products Pricing Login Sign up " * 80
    facts = "Cam Ranh temperature today is 31° with 65% humidity and wind 12 km/h. "
    fine_print = "Terms of service privacy policy cookies " * 80

    excerpt = best_excerpt(menu + facts + fine_print, "Cam Ranh temperature today", chars=600)

    assert "31°" in excerpt and len(excerpt) <= 600


def test_a_list_is_kept_whole_even_when_the_menu_repeats_the_question() -> None:
    # The page the question was answered wrongly from: a menu naming "Giá trị cốt lõi" over
    # and over, then the eight values. Half the list given, the model made up the other half.
    menu = "Trang Chủ Giới Thiệu Giá trị cốt lõi Lịch sử phát triển Viettel " * 12
    values = (
        "Giá trị cốt lõi của Viettel: 1. Thực tiễn là tiêu chuẩn kiểm nghiệm chân lý. "
        "2. Trưởng thành qua những thách thức và thất bại. 3. Thích ứng nhanh là sức mạnh "
        "cạnh tranh. 4. Sáng tạo là sức sống. 5. Tư duy hệ thống. 6. Kết hợp Đông - Tây. "
        "7. Truyền thống và cách làm người lính. 8. Viettel là ngôi nhà chung. "
    )
    fine_print = "Điều khoản sử dụng Chính sách bảo mật Liên hệ " * 40

    excerpt = best_excerpt(menu + values + fine_print, "giá trị cốt lõi Viettel", chars=600)

    assert "1. Thực tiễn" in excerpt and "8. Viettel là ngôi nhà chung" in excerpt
    assert len(excerpt) <= 600


def test_what_the_excerpt_leaves_out_is_kept_to_read_on_with() -> None:
    text = "intro words " * 100 + "the answer is 42 here " + "closing words " * 100

    excerpt, unread = split_excerpt(text, "answer", chars=600)

    assert "42" in excerpt
    # Nothing is lost: what was given and what is left hold the whole page between them.
    assert len(excerpt.replace(" ... ", " ")) + len(unread.replace(" ... ", " ")) >= len(text) - 20
    assert split_excerpt("short page", "anything") == ("short page", "")


def test_reading_on_goes_part_by_part_to_the_end_cut_at_words() -> None:
    unread = ("word " * 50).strip()

    part, rest = next_part(unread, 60)
    assert len(part) <= 60 and part.endswith("word") and rest.startswith("word")
    while rest:
        part, rest = next_part(rest, 60)
    assert part.endswith("word")
    assert next_part("x" * 100, 40) == ("x" * 40, "x" * 60)


# ---------------------------------------------------------------- adding the text to results


async def test_the_top_pages_are_read_and_the_rest_are_left(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fetch(url: str) -> str:
        return "" if "unreadable" in url else f"text of {url} " + "temperature 31° " * 5

    monkeypatch.setattr(websearch, "fetch_text", fetch)
    results = [
        WebResult("A", "https://a.example", "s"),
        WebResult("B", "https://unreadable.example", "s"),
        WebResult("C", "https://c.example", "s"),
        WebResult("D", "https://d.example", "s"),
    ]

    read = await read_pages(results, "temperature")

    assert "text of https://a.example" in read[0].content
    assert read[1].content == ""  # could not be read: still there, with its description
    assert read[2].content and read[3].content == ""  # only the first three are opened


async def test_with_nothing_found_nothing_is_read() -> None:
    assert await read_pages([], "query") == []


async def test_pages_that_take_too_long_are_given_up_on(monkeypatch: pytest.MonkeyPatch) -> None:
    async def slow(url: str) -> str:
        await asyncio.sleep(5)
        return "late"

    monkeypatch.setattr(websearch, "fetch_text", slow)
    monkeypatch.setattr(websearch, "_PAGES_BUDGET_SECONDS", 0.05)
    results = [WebResult("A", "https://a.example", "s")]

    assert await read_pages(results, "query") == results
