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
                {"title": "G", "url": "https://g.example/a", "snippet": "found"},
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

    assert found == [WebResult("G", "https://g.example/a", "found")]
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
        calls.append(1)
        if len(calls) < 3:
            # The tool answered, but with an error or nothing.
            return httpx.Response(
                200, json={"tool_results": [{"output": json.dumps({"success": False})}]}
            )
        output = {"success": True, "results": [{"title": "G", "url": "https://g.example"}]}
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
        calls.append(1)
        return httpx.Response(200, json={"choices": []})

    _gateway(monkeypatch, handler)

    found = await search_web(WebConfig(True, "gateway", "k", "http://g.test/v1", "m"), "nginx")

    assert found == [] and len(calls) == 3


def test_web_pages_without_marks_are_still_listed_as_what_the_answer_was_read_from() -> None:
    result = finish("Reload keeps connections open.", "answer", [], WEB)

    assert result.found and result.basis == "web" and [w.n for w in result.web_sources] == [1]
