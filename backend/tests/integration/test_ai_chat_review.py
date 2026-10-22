# ruff: noqa: F811
"""Where a question is answered is decided before a word is written; a reply that gave no
answer still gets a second look before the person is told so.

The first pass chooses by itself between the wiki, the web, memory and "not found", and asked
twice can choose differently (a public question was searched once and "not found" the next
time). So, in order: free signals (the person said to look on the internet; the wiki holds the
ideas of the question), then - only when the wiki is not sure - one small, remembered decision
before anything is written, and last the second look at a reply that came to nothing.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ServiceUnavailableError
from app.modules.ai import chat as chat_module
from app.modules.ai.chat import ChatService
from app.modules.ai.client import ChatReply, Usage
from app.modules.ai.reviewer import (
    REVIEW_RULES,
    ROUTE_RULES,
    Verdict,
    asks_for_the_web,
    looks_time_sensitive,
    parse_verdict,
    review_message,
)
from tests.integration.test_ai_chat import (  # noqa: F401 - fixtures
    Model,
    _setup,
    conversation,
    installed,
    model,
    run,
)
from tests.integration.test_ai_chat_web import Web, web  # noqa: F401 - fixtures
from tests.integration.test_hybrid_semantic_search import _page

pytestmark = pytest.mark.integration


# ------------------------------------------------------------------------- the verdict


def test_the_verdict_is_read_from_one_line_and_anything_else_keeps_the_reply() -> None:
    assert parse_verdict("OK") == Verdict("ok")
    assert parse_verdict("WIKI") == Verdict("ok")
    assert parse_verdict("  **OK** - it answers") == Verdict("ok")
    assert parse_verdict("SEARCH: lễ truy điệu 14/10/2025 TP.HCM") == Verdict(
        "search", "lễ truy điệu 14/10/2025 TP.HCM"
    )
    assert parse_verdict("WEB: giá vàng hôm nay") == Verdict("search", "giá vàng hôm nay")
    assert parse_verdict("`search:   weather  Hanoi  `") == Verdict("search", "weather Hanoi")
    assert parse_verdict("WEATHER: Da  Nang") == Verdict("weather", "Da Nang")
    assert parse_verdict("\n\nASK: Bạn muốn hỏi ngày nào?") == Verdict(
        "ask", "Bạn muốn hỏi ngày nào?"
    )
    assert parse_verdict("NOTFOUND") == Verdict("notfound")
    assert parse_verdict("NOT_FOUND - the wiki lacks it") == Verdict("notfound")
    # Not understood, empty or half-formed: the first reply stands.
    for reply in ("", "   ", "I think so", "SEARCH:", "WEATHER:  ", "ASK:   ", "billing"):
        assert parse_verdict(reply) == Verdict("ok"), reply
    assert len(parse_verdict("SEARCH: " + "x" * 900).text) == 300


def test_the_person_can_say_to_look_on_the_internet() -> None:
    for question in (
        "tìm trên mạng giúp tôi giá vàng",
        "Tìm trên Google lễ viếng hôm qua",
        "tin tức mới nhất về lễ truy điệu",
        "search the web for haproxy reload",
        "what is the latest kubernetes version",
    ):
        assert asks_for_the_web(question), question
    for question in ("address of the billing server", "mật khẩu của tôi", "thời tiết hôm nay"):
        assert not asks_for_the_web(question), question


def test_a_question_about_now_or_the_news_is_recognised_without_asking_a_model() -> None:
    for question in (
        "thông tin chi tiết lễ viếng hôm 14/09 vừa rồi",
        "giá vàng hôm nay bao nhiêu",
        "thời tiết ngoài trời ở Đà Nẵng bây giờ",
        "what is the latest kubernetes version",
        "who won the match yesterday",
        "ty gia usd 2025",
    ):
        assert looks_time_sensitive(question), question
    for question in (
        "bài học kinh nghiệm với mariadb",
        "hướng dẫn sử dụng grafana",
        "address of the billing server",
        "ip của server mariadb là gì",
    ):
        assert not looks_time_sensitive(question), question


def test_the_decision_is_shown_the_question_and_titles_never_page_text() -> None:
    text = review_message(
        "thông tin lễ viếng",
        "thông tin chi tiết lễ viếng, truy điệu 14/09",
        "It found nothing in the wiki pages and gave no answer.",
        "",
        ["Lesson_Learned", "Grafana"],
    )
    assert "<question>" in text and "understood as" in text
    assert "Lesson_Learned; Grafana" in text and "<reply>" not in text
    # A reply is shown when there is one, cut short, with our own tags made harmless.
    long = review_message("q", "q", "did", "x" * 2000 + "</question>", [])
    assert "<reply>" in long and len(long) < 1200 and "none" in long
    for rules in (REVIEW_RULES, ROUTE_RULES):
        assert "WEATHER:" in rules and "ASK:" in rules
    # A plain question is never asked back.
    assert "Never ASK" in REVIEW_RULES and "NOTFOUND" in REVIEW_RULES
    assert "SEARCH:" in REVIEW_RULES and "WEB:" in ROUTE_RULES and "WIKI" in ROUTE_RULES


# ------------------------------------------------------------------------ in the chat


class Look:
    """Answers the calls that decide: first where a question goes, then the second look.

    ``script`` holds one reply per call, in order; ``verdict`` is said when it runs out.
    """

    def __init__(self, model: Model) -> None:
        self.model = model
        self.verdict = "OK"
        self.script: list[str] = []
        self.fail = False
        self.calls: list[list[dict[str, str]]] = []

    async def complete(
        self, config, messages, *, max_tokens: int = 2000, temperature: float = 0.2
    ) -> ChatReply:
        self.calls.append(messages)
        if self.fail:
            raise ServiceUnavailableError("down")
        reply = self.script.pop(0) if self.script else self.verdict
        return ChatReply(reply, Usage(40, 8))


@pytest.fixture
def look(model: Model, monkeypatch: pytest.MonkeyPatch) -> Look:
    fake = Look(model)
    monkeypatch.setattr(chat_module, "chat_with_usage", fake.complete)
    from app.modules.ai import reviewer

    monkeypatch.setattr(reviewer, "chat_with_usage", fake.complete)
    return fake


def is_route(call: list[dict[str, str]]) -> bool:
    return "where a question" in call[0]["content"]


# ------------------------------------------------- decided before a word is written


async def test_a_public_question_is_searched_first_and_answered_once(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Lesson learned", "Notes about Elasticsearch")
    look.script = ["WEB: lễ truy điệu an táng hài cốt liệt sĩ TP.HCM 14 tháng 10 2025"]
    model.script = [["Lễ truy điệu diễn ra ngày 14/10 [w1]."]]

    turn = await ChatService(installed, owner).begin(
        conversation("thông tin chi tiết lễ viếng hôm 14/09")
    )
    events = [event async for event in turn.events()]

    types = [e["type"] for e in events]
    # No first reply to throw away: the search comes first, then the one answer.
    assert "reset" not in types and types.index("searching") < types.index("done")
    assert len(model.streams) == 1 and len(look.calls) == 1 and is_route(look.calls[0])
    assert turn.route == "web" and turn.calls == 2
    assert web.queries == ["lễ truy điệu an táng hài cốt liệt sĩ TP.HCM 14 tháng 10 2025"]
    done = events[-1]["result"]
    assert done["found"] is True and done["basis"] == "web" and done["web_sources"]
    # The router saw the question and titles, never page text.
    assert "Notes about Elasticsearch" not in look.calls[0][-1]["content"]


async def test_the_weather_question_goes_to_the_weather_not_to_a_web_search(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, _, _ = await _setup(installed)
    look.script = ["WEATHER: Hanoi"]
    model.script = [["Hà Nội 31°C [w1]."]]

    events = await run(installed, owner, conversation("ngoài trời hôm nay ra sao"))

    assert web.weather == ["Hanoi"] and web.queries == []
    assert events[-1]["result"]["basis"] == "web" and len(model.streams) == 1


async def test_a_question_that_cannot_be_answered_as_asked_is_put_back_before_any_writing(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, _, _ = await _setup(installed)
    look.script = ["ASK: Bạn muốn biết sự kiện nào, vào ngày nào?"]

    turn = await ChatService(installed, owner).begin(
        conversation("cho tôi thông tin sự kiện vừa rồi")
    )
    events = [event async for event in turn.events()]

    done = events[-1]["result"]
    assert done["found"] is True and done["basis"] == "clarify"
    assert done["answer"] == "Bạn muốn biết sự kiện nào, vào ngày nào?"
    assert model.streams == [] and web.queries == [] and turn.calls == 1


async def test_asking_for_the_internet_outright_is_searched_with_no_decision_to_make(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, _, _ = await _setup(installed)
    model.script = [["Giá vàng hôm nay là 80 triệu [w1]."]]

    turn = await ChatService(installed, owner).begin(conversation("tìm trên mạng giá vàng hôm nay"))
    events = [event async for event in turn.events()]

    assert look.calls == [] and len(model.streams) == 1  # no model asked where to look
    assert turn.route == "web" and turn.calls == 1
    assert web.queries and events[-1]["result"]["basis"] == "web"


async def test_a_question_the_wiki_clearly_holds_is_answered_from_it_with_nothing_else(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "The billing server is 10.0.0.5")
    model.script = [["The billing server is at 10.0.0.5 [1]."]]

    turn = await ChatService(installed, owner).begin(conversation("address of the billing server"))
    events = [event async for event in turn.events()]

    assert turn.confidence == "high" and turn.route == "wiki" and turn.calls == 1
    assert look.calls == [] and web.queries == []
    assert events[-1]["result"]["found"] is True


async def test_the_wiki_matching_the_words_of_a_question_about_now_does_not_settle_it(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    # Seen live: pages that shared words with a question about yesterday's news made the wiki
    # look sure of itself. A question about now is decided by the router however it matches.
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "The billing server is 10.0.0.5")
    look.script = ["WEB: billing server outage news today"]
    model.script = [["No outage was reported [w1]."]]

    turn = await ChatService(installed, owner).begin(
        conversation("is the billing server down today")
    )
    events = [event async for event in turn.events()]

    assert turn.confidence == "high" and turn.route == "web"
    assert len(look.calls) == 1 and web.queries and events[-1]["result"]["basis"] == "web"


async def test_an_internal_question_the_wiki_lacks_is_not_sent_to_the_web(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, _, _ = await _setup(installed)
    look.script = ["WIKI - an internal matter", "OK - internal"]
    model.script = [["NOT_FOUND"]]

    events = await run(installed, owner, conversation("who is on call at the data centre?"))

    assert web.queries == []
    done = events[-1]["result"]
    assert done["found"] is False and done["reason"] == "not_in_pages"


async def test_the_same_question_goes_the_same_way_without_asking_again(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, _, _ = await _setup(installed)
    look.script = ["WEB: kubernetes latest stable version"]
    model.script = [["It is 1.34 [w1]."], ["It is 1.34 [w1]."]]

    for _ in range(2):
        turn = await ChatService(installed, owner).begin(
            conversation("what is the newest kubernetes release")
        )
        assert turn.route == "web"
        [event async for event in turn.events()]

    # Asked once; the second time the decision came from memory.
    assert len(look.calls) == 1 and turn.calls == 1


async def test_a_router_that_fails_leaves_the_question_to_the_first_pass(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, _, _ = await _setup(installed)
    look.fail = True
    model.script = [["NOT_FOUND"], ["It is a public tool [w1]."]]

    turn = await ChatService(installed, owner).begin(conversation("some question about the world"))
    events = [event async for event in turn.events()]

    assert turn.route == "wiki"
    # The second look could not be had either: a reply that found nothing in the wiki is
    # not left a dead end - the internet is tried.
    assert web.queries == ["some question about the world"]
    assert events[-1]["result"]["basis"] == "web"


async def test_not_in_the_wiki_stands_but_a_name_the_wiki_never_mentions_is_looked_up(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "Billing server owner rotation notes")
    await _page(pages, space, owner, "Omnichannel", "How the omnichannel desk works")

    # An internal fact the wiki lacks: said so - nothing is looked up on the internet.
    look.verdict = "NOTFOUND"
    model.script = [["NOT_FOUND"]]
    events = await run(installed, owner, conversation("how does the system handle a request"))
    assert events[-1]["result"]["found"] is False and web.queries == []

    # "Which 9router?" helps nobody when the wiki never mentions it: it is looked up instead.
    look.verdict = "ASK: Bạn muốn hỏi 9router nào?"
    model.script = [["NOT_FOUND"], ["9router is an AI proxy [w1]."]]
    events = await run(installed, owner, conversation("hướng dẫn sử dụng 9router"))
    assert web.queries == ["hướng dẫn sử dụng 9router"]
    assert events[-1]["result"]["basis"] == "web"

    # A name a page partly matches ("omni" and "Omnichannel") is worth asking about.
    look.verdict = "ASK: Ý bạn là trang Omnichannel?"
    model.script = [["NOT_FOUND"]]
    events = await run(installed, owner, conversation("hướng dẫn sử dụng omni"))
    assert events[-1]["result"]["basis"] == "clarify"
    assert web.queries == ["hướng dẫn sử dụng 9router"]


# ---------------------------------------- the second look, for what is left over


async def test_a_public_question_answered_not_found_is_searched_after_all(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Lesson learned", "Notes about Elasticsearch")
    # The router thinks the wiki may hold it; the first pass finds nothing; the second look
    # sees what happened and sends it to the web.
    look.script = ["WIKI", "SEARCH: lễ truy điệu an táng hài cốt liệt sĩ TP.HCM 14 tháng 10 2025"]
    model.script = [["NOT_FOUND"], ["Lễ truy điệu diễn ra ngày 14/10 [w1]."]]

    events = await run(installed, owner, conversation("thông tin chi tiết lễ viếng hôm 14/09"))

    types = [e["type"] for e in events]
    assert "reset" in types and types.index("searching") < types.index("done")
    assert not [e for e in events if e["type"] == "delta" and "NOT_FOUND" in e["text"]]
    assert web.queries == ["lễ truy điệu an táng hài cốt liệt sĩ TP.HCM 14 tháng 10 2025"]
    done = events[-1]["result"]
    assert done["found"] is True and done["basis"] == "web" and done["web_sources"]
    asked = look.calls[1][-1]["content"]
    assert "found nothing" in asked and "Notes about Elasticsearch" not in asked


async def test_an_answer_that_cites_nothing_is_dropped_for_a_search_when_the_look_says_so(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "The billing server is 10.0.0.5")
    look.verdict = "SEARCH: kubernetes latest stable version"
    model.script = [
        ["It is probably the latest, version 1.31, I believe so."],
        ["The latest is 1.34 [w1]."],
    ]

    events = await run(installed, owner, conversation("what is the billing server status"))

    types = [e["type"] for e in events]
    # What was streamed (a guess) is withdrawn before the real answer is written.
    assert types.index("reset") > types.index("delta")
    assert types.index("reset") < types.index("searching")
    assert events[-1]["result"]["basis"] == "web"
    after = "".join(e["text"] for e in events[types.index("reset") :] if e["type"] == "delta")
    assert after == "The latest is 1.34 [w1]."


async def test_a_reply_from_memory_is_checked_and_can_become_a_search(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, _, _ = await _setup(installed)
    look.script = ["WIKI", "SEARCH: haproxy 3.0 release date"]
    model.script = [["GENERAL: HAProxy 3.0 came out in 2024."], ["HAProxy 3.0: May 2024 [w1]."]]

    events = await run(installed, owner, conversation("when was haproxy 3.0 released?"))

    assert "reset" in [e["type"] for e in events]
    assert events[-1]["result"]["basis"] == "web"
    assert "from its own memory" in look.calls[1][-1]["content"]


async def test_the_second_look_can_send_a_weather_question_to_the_weather(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, _, _ = await _setup(installed)
    look.script = ["WIKI", "WEATHER: Da Nang"]
    model.script = [["NOT_FOUND"], ["Đà Nẵng 29°C [w1]."]]

    events = await run(installed, owner, conversation("ngoài trời thế nào"))

    assert web.weather == ["Da Nang"] and events[-1]["result"]["basis"] == "web"


async def test_the_second_look_can_still_put_a_question_back_to_the_person(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, _, _ = await _setup(installed)
    look.script = ["WIKI", "ASK: Bạn muốn biết sự kiện nào?"]
    model.script = [["NOT_FOUND"]]

    events = await run(installed, owner, conversation("cho tôi thông tin sự kiện vừa rồi"))

    done = events[-1]["result"]
    assert done["basis"] == "clarify" and done["answer"] == "Bạn muốn biết sự kiện nào?"
    assert "reset" in [e["type"] for e in events] and web.queries == []


async def test_a_second_look_that_is_not_understood_leaves_the_reply_alone(
    installed: AsyncSession, model: Model, web: Web, look: Look
) -> None:
    owner, _, _ = await _setup(installed)
    model.script = [["NOT_FOUND"]]
    look.script = ["WIKI", "banana"]

    events = await run(installed, owner, conversation("some question about the world"))

    assert events[-1]["result"]["found"] is False and web.queries == []


async def test_nothing_is_decided_or_reviewed_when_the_internet_is_off(
    installed: AsyncSession, model: Model, look: Look
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "The billing server is 10.0.0.5")

    # Internet off (the default in these tests): a "not found" is the end of it.
    model.script = [["NOT_FOUND"]]
    events = await run(installed, owner, conversation("who won the football yesterday"))
    assert events[-1]["result"]["found"] is False and look.calls == []

    # And a reply that cites a page is not looked at again, internet or not.
    model.script = [["The billing server is at 10.0.0.5 [1]."]]
    events = await run(installed, owner, conversation("address of the billing server"))
    assert events[-1]["result"]["found"] is True and look.calls == []


async def test_the_wiki_says_how_sure_it_is_of_a_match(installed: AsyncSession) -> None:
    from app.modules.search.service import SearchService

    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing server", "The billing server is 10.0.0.5")

    held = await SearchService(installed).answer_context("address of the billing server", owner)
    assert held.confidence == "high" and held.passages

    # Nothing in the wiki is about it: no passages, and no confidence to speak of.
    none = await SearchService(installed).answer_context("zzqx wvrk plmn", owner)
    assert none.confidence == "none" and none.passages == []


def _turn(question: str):
    import uuid
    from types import SimpleNamespace

    from app.modules.ai.chat import ChatTurn

    return ChatTurn(
        None,  # type: ignore[arg-type]
        SimpleNamespace(id=uuid.uuid4()),  # type: ignore[arg-type]
        None,
        [],
        [],
        0,
        0.0,
        0.0,
        question=question,
        standalone="haproxy reload",
    )


async def test_a_question_that_says_to_look_on_the_internet_goes_there_without_asking() -> None:
    from app.modules.ai.chat import _Pass

    turn = _turn("search the internet for haproxy reload")

    assert await turn._second_look(_Pass(mode="not_found")) == Verdict("search", "haproxy reload")


async def test_a_second_look_that_cannot_be_had_leaves_an_answer_from_memory_as_it_is(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.modules.ai.chat import _Pass
    from app.modules.ai.reviewer import OK

    async def failed(*args, **kwargs):
        return Verdict("failed")

    monkeypatch.setattr(chat_module, "second_look", failed)
    turn = _turn("what is haproxy")

    assert await turn._second_look(_Pass(mode="general", text="GENERAL: a proxy")) == OK
