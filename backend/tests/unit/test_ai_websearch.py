"""Searching the internet for the chat: what is sent out, and how the answers are read."""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.exceptions import ServiceUnavailableError
from app.modules.ai import websearch
from app.modules.ai.chat import finish
from app.modules.ai.websearch import WebConfig, WebResult, public_query, search_web
from app.schemas.ai import AnswerSource, WebSource


@pytest.mark.parametrize(
    ("asked", "sent"),
    [
        ("haproxy reload vs restart", "haproxy reload vs restart"),
        ("haproxy reload 10.0.0.5:8080 vs restart", "haproxy reload vs restart"),
        ("why does db01.corp refuse admin@example.com logins", "why does refuse logins"),
        ("see https://wiki.corp.example/x about nginx tuning", "see about nginx tuning"),
        ('what is "nginx" `upstream`', "what is nginx upstream"),
        ("login with password: hunter2 on nginx", "login with password: [hidden] on nginx"),
    ],
)
def test_what_looks_internal_is_taken_out_of_a_query(asked: str, sent: str) -> None:
    assert public_query(asked) == sent


@pytest.mark.parametrize("asked", ["", "10.0.0.5", "db01.corp admin@corp.example", "a b", "   "])
def test_a_query_with_nothing_public_left_is_not_sent_at_all(asked: str) -> None:
    assert public_query(asked) == ""


def test_a_query_is_cut_short() -> None:
    assert len(public_query("word " * 200)) <= 200


def _gateway(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    real = httpx.AsyncClient
    monkeypatch.setattr(
        websearch.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )


async def test_tavily_results_are_read(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "results": [
                    {"title": "A", "url": "https://a.example/x", "content": "alpha  beta"},
                    {"title": "bad", "url": "javascript:alert(1)", "content": "x"},
                ]
            },
        )

    _gateway(monkeypatch, handler)

    found = await search_web(WebConfig(True, "tavily", "k"), "nginx tuning")

    assert found == [WebResult("A", "https://a.example/x", "alpha beta")]
    assert seen[0].headers["authorization"] == "Bearer k"
    assert json.loads(seen[0].content)["query"] == "nginx tuning"


async def test_brave_results_are_read(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-subscription-token"] == "k"
        assert request.url.params["q"] == "nginx tuning"
        body = {
            "web": {"results": [{"title": "B", "url": "https://b.example", "description": "d"}]}
        }
        return httpx.Response(200, json=body)

    _gateway(monkeypatch, handler)

    found = await search_web(WebConfig(True, "brave", "k"), "nginx tuning")

    assert [r.url for r in found] == ["https://b.example"]


async def test_serper_results_are_read(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-api-key"] == "k"
        body = {"organic": [{"title": "C", "link": "https://c.example/p", "snippet": "s"}]}
        return httpx.Response(200, json=body)

    _gateway(monkeypatch, handler)

    found = await search_web(WebConfig(True, "serper", "k"), "nginx tuning")

    assert found[0].host == "c.example" and found[0].snippet == "s"


async def test_a_service_that_fails_is_an_error_without_the_query_in_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _gateway(monkeypatch, lambda request: httpx.Response(401))

    with pytest.raises(ServiceUnavailableError) as raised:
        await search_web(WebConfig(True, "tavily", "k"), "secret question words")

    assert "secret question" not in str(raised.value)


async def test_it_will_not_search_when_it_is_off_or_has_no_key() -> None:
    for config in (WebConfig(False, "tavily", "k"), WebConfig(True, "tavily", "")):
        with pytest.raises(ServiceUnavailableError):
            await search_web(config, "nginx tuning")


# ---------------------------------------------------------------- what the answer stands on

WIKI = [
    AnswerSource(
        n=1,
        id="00000000-0000-0000-0000-000000000001",
        title="Page",
        slug="page",
        space_key="OPS",
        space_name="Ops",
        excerpt="x",
    )
]
WEB = [WebSource(n=1, title="Doc", url="https://d.example", host="d.example", snippet="s")]


def test_an_answer_citing_the_wiki_stands_on_the_wiki() -> None:
    result = finish("It is 10.0.0.5 [1].", "answer", WIKI, [])

    assert result.found and result.basis == "wiki" and [s.n for s in result.sources] == [1]


def test_an_answer_citing_a_web_page_stands_on_the_web() -> None:
    result = finish("Reload is graceful [w1].", "answer", [], WEB)

    assert result.basis == "web" and [w.n for w in result.web_sources] == [1]
    assert result.sources == []


def test_wiki_and_web_marks_can_be_mixed_and_a_made_up_mark_is_dropped() -> None:
    result = finish("Ours is 10.0.0.5 [1]; upstream says so [w1] and [w4].", "answer", WIKI, WEB)

    assert result.basis == "web"
    assert [s.n for s in result.sources] == [1] and [w.n for w in result.web_sources] == [1]
    assert "[w4]" not in result.answer and "  " not in result.answer


def test_an_answer_citing_nothing_is_not_an_answer() -> None:
    # No wiki page, and no web page was found to read it from either.
    result = finish("It is probably fine.", "answer", WIKI, [])

    assert result.found is False and result.reason == "ungrounded"


def test_general_knowledge_needs_no_citation_and_says_what_it_is() -> None:
    result = finish("A load balancer spreads requests.", "general", WIKI, [])

    assert result.found and result.basis == "general"
    assert result.sources == [] and result.related == []


def test_general_knowledge_never_carries_a_secret_or_a_stray_mark() -> None:
    result = finish("Use password: hunter2 [1] to log in.", "general", WIKI, [])

    assert "hunter2" not in result.answer and "[1]" not in result.answer


def test_not_found_is_not_found() -> None:
    result = finish("", "not_found", WIKI, [])

    assert result.found is False and result.reason == "not_in_pages"


async def test_the_gateway_searches_with_its_own_tool_and_returns_what_it_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer k"
        output = {
            "success": True,
            "results": [
                {"title": "G nginx tuning", "url": "https://g.example/a", "snippet": "found"},
                {"title": "no address", "url": "", "snippet": "x"},
            ],
        }
        reply = {
            "choices": [{"finish_reason": "tool_calls", "message": {"content": None}}],
            "tool_results": [{"output": json.dumps(output)}, {"output": "not json"}],
        }
        return httpx.Response(200, json=reply)

    _gateway(monkeypatch, handler)
    config = WebConfig(True, "gateway", "k", "http://gateway.test/v1/", "m")

    found = await search_web(config, "nginx tuning")

    assert found == [WebResult("G nginx tuning", "https://g.example/a", "found")]
    assert seen[0]["tools"] == [{"type": "web_search", "web_search": {"enable": True}}]
    assert seen[0]["max_tokens"] <= 500 and "nginx tuning" in seen[0]["messages"][0]["content"]


async def test_a_gateway_that_returns_no_search_results_gives_an_empty_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _gateway(monkeypatch, lambda request: httpx.Response(200, json={"choices": []}))

    found = await search_web(WebConfig(True, "gateway", "k", "http://g.test/v1", "m"), "nginx")

    assert found == []


def test_the_gateway_is_ready_only_with_an_ai_connection_behind_it() -> None:
    assert WebConfig(True, "gateway", "k", "http://g.test/v1", "m").ready is True
    assert WebConfig(True, "gateway", "", "", "").ready is False
    assert WebConfig(False, "gateway", "k", "http://g.test/v1", "m").ready is False


async def test_the_gateway_is_tried_again_when_a_search_comes_back_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(websearch, "_GATEWAY_PAUSE_SECONDS", 0)
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host != "g.test":  # the free sources, asked for the single result
            return httpx.Response(500)
        calls.append(1)
        if len(calls) < 3:
            # The tool answered, but with an error or nothing.
            return httpx.Response(
                200, json={"tool_results": [{"output": json.dumps({"success": False})}]}
            )
        output = {"success": True, "results": [{"title": "G nginx", "url": "https://g.example"}]}
        return httpx.Response(200, json={"tool_results": [{"output": json.dumps(output)}]})

    _gateway(monkeypatch, handler)

    found = await search_web(WebConfig(True, "gateway", "k", "http://g.test/v1", "m"), "nginx")

    assert [r.url for r in found] == ["https://g.example"] and len(calls) == 3


async def test_the_gateway_gives_up_after_a_few_tries_with_no_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(websearch, "_GATEWAY_PAUSE_SECONDS", 0)
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "g.test":
            calls.append(1)
        return httpx.Response(200, json={"choices": []})

    _gateway(monkeypatch, handler)

    # Only the gateway's own tries are counted: the free sources then find nothing either.
    found = await search_web(WebConfig(True, "gateway", "k", "http://g.test/v1", "m"), "nginx")

    assert found == [] and len(calls) == 3


def test_web_pages_without_marks_are_still_listed_as_what_the_answer_was_read_from() -> None:
    result = finish("Reload keeps connections open.", "answer", [], WEB)

    assert result.found and result.basis == "web" and [w.n for w in result.web_sources] == [1]


# ------------------------------------------------------------ free sources, when the rest is empty

FREE_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>q</title>
<item><title>Lễ an táng 731 liệt sĩ - Báo A</title>
<link>https://news.example/a1</link><pubDate>Wed, 14 Oct 2026 12:36:00 GMT</pubDate>
<description>&lt;a href="x"&gt;Lễ an táng 731 liệt sĩ&lt;/a&gt;&amp;nbsp;&lt;font&gt;Báo A&lt;/font&gt;</description>
<source url="https://a.example">Báo A</source></item>
<item><title>Lễ an táng 731 liệt sĩ - Báo A</title><link>https://news.example/a2</link></item>
<item><title>No address</title><link>javascript:alert(1)</link></item>
<item><title>Tiễn đưa 731 liệt sĩ</title><link>https://news.example/b</link>
<source url="https://b.example">Báo B</source></item>
</channel></rss>"""

FREE_WIKI = {
    "query": {
        "pages": {
            "2": {
                "index": 2,
                "title": "B",
                "fullurl": "https://vi.wikipedia.org/wiki/B",
                "extract": "B is another thing.",
            },
            "1": {
                "index": 1,
                "title": "A",
                "fullurl": "https://vi.wikipedia.org/wiki/A",
                "extract": "A is a thing.  It has facts.",
            },
            "3": {"index": 3, "title": "No text", "fullurl": "https://vi.wikipedia.org/wiki/C"},
        }
    }
}


def test_a_news_feed_is_read_into_headlines_with_paper_and_day() -> None:
    found = websearch.parse_news(FREE_FEED)

    assert [r.title for r in found] == ["Lễ an táng 731 liệt sĩ - Báo A", "Tiễn đưa 731 liệt sĩ"]
    first = found[0]
    # What a result says is already in it: nothing more to read from the page.
    assert first.url == "https://news.example/a1" and first.content == first.snippet
    assert first.snippet.startswith("Báo A | Wed, 14 Oct 2026") and "<" not in first.snippet
    assert "javascript" not in " ".join(r.url for r in found)


def test_a_feed_with_a_dtd_or_that_is_not_xml_is_not_parsed() -> None:
    bomb = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><rss><channel/></rss>'
    assert websearch.parse_news(bomb) == []
    assert websearch.parse_news("not xml at all") == []
    assert websearch.parse_news('{"json": true}') == []


def test_the_language_of_the_free_sources_follows_the_query() -> None:
    assert websearch._is_vietnamese("lễ viếng liệt sĩ") is True
    assert websearch._is_vietnamese("haproxy reload vs restart") is False


async def test_free_sources_give_news_first_then_the_encyclopedia(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "news.google.com":
            return httpx.Response(200, text=FREE_FEED)
        return httpx.Response(200, json=FREE_WIKI)

    _gateway(monkeypatch, handler)

    found = await websearch.free_sources("lễ an táng liệt sĩ")

    assert [r.title for r in found] == [
        "Lễ an táng 731 liệt sĩ - Báo A",
        "Tiễn đưa 731 liệt sĩ",
        "A - Wikipedia",
        "B - Wikipedia",
    ]
    assert found[2].content == "A is a thing. It has facts."
    news = next(r for r in seen if r.url.host == "news.google.com")
    assert news.url.params["hl"] == "vi" and news.url.params["q"] == "lễ an táng liệt sĩ"
    wiki = next(r for r in seen if "wikipedia" in r.url.host)
    assert wiki.url.host == "vi.wikipedia.org"
    # Only the query leaves: no cookies, no keys.
    assert all("authorization" not in r.headers for r in seen)


async def test_one_free_source_failing_does_not_lose_the_other(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = {"news": 503, "wiki": 200}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "news.google.com":
            return httpx.Response(state["news"])
        if state["wiki"] != 200:
            return httpx.Response(state["wiki"])
        return httpx.Response(200, json=FREE_WIKI)

    _gateway(monkeypatch, handler)

    found = await websearch.free_sources("what is a thing")
    assert [r.title for r in found] == ["A - Wikipedia", "B - Wikipedia"]

    state["wiki"] = 500
    assert await websearch.free_sources("what is a thing") == []


async def test_a_search_that_comes_back_empty_falls_back_to_the_free_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.tavily.com":
            return httpx.Response(200, json={"results": []})
        if request.url.host == "news.google.com":
            return httpx.Response(200, text=FREE_FEED)
        return httpx.Response(200, json=FREE_WIKI)

    _gateway(monkeypatch, handler)
    config = WebConfig(True, "tavily", "k")

    found = await search_web(config, "lễ an táng liệt sĩ")
    assert found and found[0].title.startswith("Lễ an táng")

    # Testing the configured service alone does not borrow the free ones.
    assert await search_web(config, "lễ an táng liệt sĩ", fallback=False) == []


async def test_a_configured_service_that_fails_is_still_an_error_when_nothing_else_answers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    free = {"on": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.tavily.com" or not free["on"]:
            return httpx.Response(401)
        return httpx.Response(200, json=FREE_WIKI)

    _gateway(monkeypatch, handler)
    config = WebConfig(True, "tavily", "k")

    with pytest.raises(ServiceUnavailableError):
        await search_web(config, "nginx tuning")
    with pytest.raises(ServiceUnavailableError):
        await search_web(config, "nginx tuning", fallback=False)

    # But when the free sources have something, that is the answer.
    free["on"] = True
    found = await search_web(config, "nginx tuning")
    assert [r.title for r in found] == ["A - Wikipedia", "B - Wikipedia"]


async def test_a_service_that_is_not_set_up_is_an_error_not_a_reason_to_use_free_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _gateway(monkeypatch, lambda request: httpx.Response(200, json=FREE_WIKI))

    with pytest.raises(ServiceUnavailableError):
        await search_web(WebConfig(False, "tavily", "k"), "nginx tuning")
    with pytest.raises(ServiceUnavailableError):
        await search_web(WebConfig(True, "tavily", ""), "nginx tuning")


async def test_pages_that_came_with_their_text_are_not_fetched_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fetched: list[str] = []

    async def fake_fetch(url: str) -> str:
        fetched.append(url)
        return "the page text"

    monkeypatch.setattr(websearch, "fetch_text", fake_fetch)
    results = [
        WebResult("N", "https://news.example/n", "snip", content="already said"),
        WebResult("P", "https://page.example/p", "snip"),
    ]

    read = await websearch.read_pages(results, "query")

    assert fetched == ["https://page.example/p"]
    assert read[0].content == "already said" and read[1].content


# --------------------------------------------- the open web, when the configured search is empty

BING = """<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>Bing: q</title>
<item><title>So sánh Air Blade 2026 và 2025</title><link>https://shop.example/ab</link>
<description>Bản mới có gì và mất gì &amp; giá.</description></item>
<item><title>Honda AB 2025 vs 2026</title><link>https://other.example/ab</link>
<description>So sánh chi tiết</description></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
</channel></rss>"""

DDG = """<html><body><table>
<tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fshop.example%2Fab&rut=x">
So sánh AB</a></td></tr>
<tr><td class="result-snippet">Bản mới có gì</td></tr>
<tr><td><a class="result-link" href="https://direct.example/page">Direct</a></td></tr>
<tr><td class="result-snippet">Một đoạn</td></tr>
<tr><td><a class="result-link" href="javascript:void(0)">bad</a></td></tr>
</table></body></html>"""


def test_bing_results_are_read_with_their_addresses() -> None:
    found = websearch.parse_web(BING)

    assert [(r.title, r.url) for r in found] == [
        ("So sánh Air Blade 2026 và 2025", "https://shop.example/ab"),
        ("Honda AB 2025 vs 2026", "https://other.example/ab"),
    ]
    assert found[0].snippet == "Bản mới có gì và mất gì & giá." and found[0].content == ""
    assert websearch.parse_web("not xml") == []
    assert websearch.parse_web('<!DOCTYPE x [<!ENTITY a "b">]><rss/>') == []


def test_duckduckgo_results_are_read_and_its_redirect_is_undone() -> None:
    found = websearch.parse_duckduckgo(DDG)

    assert [(r.title, r.url, r.snippet) for r in found] == [
        ("So sánh AB", "https://shop.example/ab", "Bản mới có gì"),
        ("Direct", "https://direct.example/page", "Một đoạn"),
    ]
    assert websearch.parse_duckduckgo("<html></html>") == []


async def test_the_open_web_comes_first_and_is_asked_in_the_language_of_the_question(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "www.bing.com":
            return httpx.Response(200, text=BING)
        if request.url.host == "news.google.com":
            return httpx.Response(200, text=FREE_FEED)
        return httpx.Response(200, json=FREE_WIKI)

    _gateway(monkeypatch, handler)

    found = await websearch.free_sources("xe ab 2026 khác gì ab 2025")

    assert [r.title for r in found][:2] == [
        "So sánh Air Blade 2026 và 2025",
        "Honda AB 2025 vs 2026",
    ]
    assert len(found) == websearch.RESULTS
    bing = next(r for r in seen if r.url.host == "www.bing.com")
    assert bing.url.params["format"] == "rss" and bing.url.params["setlang"] == "vi"
    assert "chrome" in bing.headers["user-agent"].lower()
    assert [r.url.host for r in seen if r.url.host == "www.bing.com"] == ["www.bing.com"]


async def test_duckduckgo_is_asked_when_bing_gives_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "www.bing.com":
            return httpx.Response(503)
        if request.url.host == "lite.duckduckgo.com":
            return httpx.Response(200, text=DDG)
        return httpx.Response(500)

    _gateway(monkeypatch, handler)

    found = await websearch.free_sources("what is the newest thing")

    assert [r.url for r in found] == ["https://shop.example/ab", "https://direct.example/page"]


# ----------------------------------------------- what a free gateway engine returns is checked


def _junk_gateway(results: list[dict]):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "g.test":
            output = {"success": True, "results": results}
            return httpx.Response(200, json={"tool_results": [{"output": json.dumps(output)}]})
        if request.url.host == "www.bing.com":
            return httpx.Response(200, text=BING)
        return httpx.Response(500)

    return handler


GATEWAY = WebConfig(True, "gateway", "k", "http://g.test/v1", "m")


def test_results_are_kept_when_they_hold_half_the_words_of_the_query() -> None:
    results = [
        WebResult("So sánh Air Blade 2026 và 2025", "https://a.example", "Bản mới"),
        WebResult("SO | meaning in the Cambridge dictionary", "https://dict.example", "so"),
        WebResult("Kết quả xổ số hôm nay", "https://lottery.example", "xs"),
    ]

    kept = websearch._about(results, "so sánh Honda Air Blade 2026 và Honda Air Blade 2025")

    assert [r.url for r in kept] == ["https://a.example"]
    # A query of no words that count cannot judge anything.
    assert websearch._about(results, "a b") == results


async def test_junk_from_a_gateway_is_replaced_by_the_free_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    junk = [
        {"title": "SO | dictionary", "url": "https://dict.example/so", "snippet": "meaning"},
        {"title": "Xổ số", "url": "https://lottery.example", "snippet": "results"},
    ]
    monkeypatch.setattr(websearch, "_GATEWAY_PAUSE_SECONDS", 0)
    _gateway(monkeypatch, _junk_gateway(junk))

    found = await search_web(GATEWAY, "so sánh Air Blade 2026 và 2025")

    assert "https://shop.example/ab" in [r.url for r in found]
    assert "https://dict.example/so" not in [r.url for r in found]


async def test_a_good_result_from_a_gateway_is_kept_and_the_rest_is_filled_in(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mixed = [
        {"title": "Air Blade 2026 và 2025", "url": "https://ok.example/ab", "snippet": "khác"},
        {"title": "SO | dictionary", "url": "https://dict.example/so", "snippet": "meaning"},
    ]
    monkeypatch.setattr(websearch, "_GATEWAY_PAUSE_SECONDS", 0)
    _gateway(monkeypatch, _junk_gateway(mixed))

    found = await search_web(GATEWAY, "so sánh Air Blade 2026 và 2025")

    urls = [r.url for r in found]
    # The good one stays first, the junk is gone, and the free sources add to it.
    assert urls[0] == "https://ok.example/ab" and "https://dict.example/so" not in urls
    assert "https://shop.example/ab" in urls and len(urls) == len(set(urls))


async def test_the_results_of_a_paid_service_are_not_second_guessed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "results": [
                    {"title": "Unrelated words", "url": "https://t.example", "content": "x"}
                ]
            },
        )

    _gateway(monkeypatch, handler)

    found = await search_web(WebConfig(True, "tavily", "k"), "so sánh Air Blade 2026 và 2025")

    assert [r.url for r in found] == ["https://t.example"]


def test_a_protocol_relative_result_address_is_made_https() -> None:
    page = (
        '<html><body><table><tr><td><a class="result-link" href="//news.example/a">'
        "Headline</a></td></tr></table></body></html>"
    )
    assert [r.url for r in websearch.parse_duckduckgo(page)] == ["https://news.example/a"]


async def test_a_search_that_is_not_set_up_is_refused_before_any_request() -> None:
    with pytest.raises(ServiceUnavailableError):
        await websearch._configured_search(websearch.OFF, "anything")
