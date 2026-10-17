"""Translating an imported page: what is taken apart, what is accepted back, what is left."""

from __future__ import annotations

import json
import time

import pytest
from bs4 import BeautifulSoup

from app.modules.document_import import translate as tr
from app.modules.document_import.translate import (
    Translation,
    collect_units,
    detect_language,
    translate_import,
)

VI = (
    "<h1>Hướng dẫn triển khai</h1>"
    "<p>Chạy lệnh <code>kubectl get pods</code> để xem <strong>trạng thái</strong> của dịch vụ.</p>"
    "<ul><li>Cài đặt Docker<ul><li>Mở cổng tám nghìn</li></ul></li></ul>"
    '<table><tr><th style="background-color:#2f5496">Môi trường</th><td>Thử nghiệm</td></tr></table>'
    "<pre>docker compose up -d</pre>"
    '<p>Xem <a href="https://example.org/a">tài liệu</a> thêm tại đây nhé.</p>'
)
WORDS = {
    "Hướng dẫn triển khai": "Deployment guide",
    "Chạy lệnh": "Run",
    "để xem": "to see the",
    "trạng thái": "status",
    "của dịch vụ.": "of the service.",
    "Cài đặt Docker": "Install Docker",
    "Mở cổng tám nghìn": "Open port eight thousand",
    "Môi trường": "Environment",
    "Thử nghiệm": "Testing",
    "Xem": "See more in the",
    "tài liệu": "documentation",
    "thêm tại đây nhé.": "here.",
}


def fake_translation(html: str) -> str:
    for source, target in WORDS.items():
        html = html.replace(source, target)
    return html


class Model:
    """Stands in for the gateway: answers each unit with ``transform`` of it."""

    def __init__(self, transform=fake_translation, replies=None):
        self.transform = transform
        self.replies = replies
        self.asked: list[list[dict]] = []

    async def __call__(self, system: str, user: str) -> str | None:
        assert "Vietnamese" in system or "English" in system
        units = json.loads(user)
        self.asked.append(units)
        if self.replies is not None:
            return self.replies.pop(0) if self.replies else None
        return json.dumps(
            [{"id": u["id"], "html": self.transform(u["html"])} for u in units],
            ensure_ascii=False,
        )


def _tags(html: str) -> list[str]:
    return [tag.name for tag in BeautifulSoup(html, "html.parser").find_all(True)]


def test_the_language_of_a_text_is_guessed_from_its_letters() -> None:
    assert detect_language("Hướng dẫn triển khai dịch vụ lên môi trường thử nghiệm") == "vi"
    assert detect_language("Follow these steps to deploy the service to staging") == "en"
    assert detect_language("Déployez le service sur l'environnement de préproduction") == "other"
    assert detect_language("ok") == "other"


def test_a_page_is_taken_apart_into_what_holds_words() -> None:
    soup = BeautifulSoup(VI, "html.parser")

    units = collect_units(soup)

    texts = [u.text.strip() for u in units]
    assert "Hướng dẫn triển khai" in texts
    # Inline formatting stays inside its sentence; inline code is not part of the words.
    assert any(u.html.startswith("Chạy lệnh <code>") and "<strong>" in u.html for u in units)
    # Each level of a nested list is its own unit; code blocks are not units at all.
    assert "Cài đặt Docker" in texts and "Mở cổng tám nghìn" in texts
    assert not any("docker compose" in u.html for u in units)
    assert not any(u.html == "<code>kubectl get pods</code>" for u in units)


def test_a_run_of_nothing_but_code_is_not_a_unit() -> None:
    units = collect_units(BeautifulSoup("<p><code>kubectl get pods</code></p>", "html.parser"))

    assert units == []


async def test_a_page_is_translated_and_keeps_its_structure() -> None:
    result = await translate_import(VI, "en", ask=Model())

    assert result.status == "done" and result.units_left == 0 and result.ai_calls == 1
    out = BeautifulSoup(result.html, "html.parser")
    assert out.h1.text == "Deployment guide"
    assert out.find("th")["style"] == "background-color:#2f5496"
    assert out.find("code").text == "kubectl get pods"
    assert out.find("pre").text == "docker compose up -d"
    assert out.find("a")["href"] == "https://example.org/a"
    assert out.find("a").text == "documentation"
    assert _tags(result.html) == _tags(VI)
    assert result.log[-1].startswith("Done: all ") and "English" in result.log[-1]


async def test_a_unit_whose_tags_changed_is_asked_again_and_then_left_alone() -> None:
    def spoil(html: str) -> str:
        # Drops the <strong> of the sentence, every time.
        return fake_translation(html).replace("<strong>", "").replace("</strong>", "")

    model = Model(spoil)

    result = await translate_import(VI, "en", ask=model)

    assert result.status == "partial" and result.units_left == 1
    assert "<strong>trạng thái</strong>" in result.html  # left as it was, tags intact
    assert any("left in the original language" in n for n in result.notes)
    assert len(model.asked) == 2 and len(model.asked[1]) == 1  # the one unit, asked again


async def test_a_bad_unit_is_put_right_by_asking_for_it_alone() -> None:
    calls = {"n": 0}

    def once_wrong(html: str) -> str:
        calls["n"] += 1
        translated = fake_translation(html)
        return translated.replace("<strong>", "").replace("</strong>", "") if "<strong>" in html and calls["n"] <= 6 else translated

    result = await translate_import(VI, "en", ask=Model(once_wrong))

    assert result.status in {"done", "partial"} and result.ai_calls > 1


async def test_nothing_is_translated_when_the_model_is_not_there_or_talks_nonsense() -> None:
    gone = await translate_import(VI, "en", ask=Model(replies=[]))
    nonsense = await translate_import(VI, "en", ask=Model(replies=["sorry, I cannot"] * 20))

    assert gone.status == "failed" and "not available" in gone.notes[-1]
    assert nonsense.status == "failed" and "could not be used" in nonsense.notes[-1]
    assert "Hướng dẫn" in gone.html


async def test_it_stops_at_its_deadline_and_says_so() -> None:
    result = await translate_import(VI, "en", ask=Model(), deadline=time.monotonic() - 1)

    assert result.status == "failed" and "ran out of time" in result.notes[-1]


async def test_the_cases_that_need_no_translation() -> None:
    model = Model()
    english = "<p>Follow these steps to deploy the service to the staging environment.</p>"

    assert (await translate_import(english, "en", ask=model)).status == "skipped"
    assert (await translate_import(VI, "fr", ask=model)).notes == ["that language is not available"]
    assert "not set up" in (await translate_import(VI, "en", ask=None)).notes[0]
    assert "no text" in (await translate_import("<pre>x</pre><hr>", "en", ask=model)).notes[0]
    assert model.asked == []


async def test_a_document_too_large_is_not_started(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tr, "MAX_CHARS", 50)
    model = Model()

    result = await translate_import(VI, "en", ask=model)

    assert result.status == "skipped" and "too large" in result.notes[0] and model.asked == []


async def test_a_long_page_goes_in_several_calls_and_each_step_is_reported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(tr, "MAX_UNITS_PER_CALL", 2)
    seen: list[list[str]] = []

    async def report(result: Translation) -> None:
        seen.append(list(result.log))

    model = Model()
    result = await translate_import(VI, "en", ask=model, report=report)

    assert result.status == "done" and len(model.asked) >= 3
    assert all(len(call) <= 2 for call in model.asked)
    assert seen and seen[-1] == result.log and len(seen[0]) == 1
    assert sum("Step" in line for line in result.log) == len(model.asked)
    assert result.as_record()["units_done"] == result.units_total


async def test_a_text_in_english_goes_to_vietnamese() -> None:
    page = "<p>Follow these steps to deploy the <em>service</em> to staging.</p>"

    def vietnamese(html: str) -> str:
        return html.replace("Follow these steps to deploy the ", "Làm theo các bước để triển khai ").replace(
            " to staging.", " lên môi trường thử nghiệm."
        )

    result = await translate_import(page, "vi", ask=Model(vietnamese))

    assert result.status == "done" and "Làm theo" in result.html
    assert "<em>service</em>" in result.html


def test_the_replies_that_are_usable_are_picked_out() -> None:
    wanted = [4, 5]
    fenced = '```json\n[{"id":4,"html":"a"},{"id":5,"html":"b"}]\n```'

    assert tr._parse_reply(fenced, wanted) == {4: "a", 5: "b"}
    assert tr._parse_reply('["a","b"]', wanted) == {4: "a", 5: "b"}
    # A list of the wrong length cannot be matched up; ids that were not asked for are ignored.
    assert tr._parse_reply('["a"]', wanted) == {}
    assert tr._parse_reply('[{"id":9,"html":"x"},{"id":4,"html":3}]', wanted) == {}
    assert tr._parse_reply("nothing here", wanted) == {}
    assert tr._parse_reply("[not json]", wanted) == {}
    assert tr._parse_reply('{"id":4}', wanted) == {}


def test_a_comment_in_the_page_is_not_text() -> None:
    units = collect_units(BeautifulSoup("<!-- a note to self --><p>Một đoạn văn thật.</p>", "html.parser"))

    assert [u.text for u in units] == ["Một đoạn văn thật."]


async def test_when_the_model_goes_away_between_a_call_and_its_retry_it_stops() -> None:
    first = json.dumps([{"id": 0, "html": "<b>"}, {"id": 1, "html": "<i>"}])
    page = "<p>Một đoạn văn thật sự khá dài để dịch.</p><p>Và một đoạn nữa cũng dài như thế.</p>"

    result = await translate_import(page, "en", ask=Model(replies=[first]))

    assert result.status == "failed" and "not available" in result.notes[-1]
