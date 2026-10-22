# ruff: noqa: F811
"""Files attached in the chat: read once, kept for their owner only, and answered from together
with the wiki - an answer citing the file stands on it as one citing a page does."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError
from app.modules.ai import chat_files
from app.modules.ai.chat import ChatService, finish
from app.modules.ai.skills import ATTACHED_FILE_RULES
from app.schemas.ai import ChatMessage, ChatRequest, FileSource
from tests.integration.test_ai_chat import (  # noqa: F401 - fixtures
    Model,
    _setup,
    installed,
    model,
    run,
)
from tests.integration.test_hybrid_semantic_search import _page, _user

pytestmark = pytest.mark.integration


class KeptFiles:
    """The Redis calls attached files make, in a dict."""

    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.ttl: dict[str, int] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.data[key] = value
        self.ttl[key] = ex or 0

    async def expire(self, key: str, seconds: int) -> None:
        self.ttl[key] = seconds


@pytest.fixture
def kept(monkeypatch: pytest.MonkeyPatch) -> KeptFiles:
    store = KeptFiles()
    monkeypatch.setattr(chat_files, "get_redis", lambda: store)
    return store


def asking(question: str, *file_ids) -> ChatRequest:
    return ChatRequest(
        messages=[ChatMessage(role="user", content=question)], file_ids=list(file_ids)
    )


async def test_an_attached_file_is_read_with_the_wiki_and_cited_as_f1(
    installed: AsyncSession, model: Model, kept: KeptFiles
) -> None:
    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing servers", "billing-1 10.0.0.5, billing-2 10.0.0.6")
    attached = await chat_files.read_upload(
        owner, "draft.txt", b"Our draft plan moves billing-1 to the new rack in May."
    )
    assert attached.filename == "draft.txt" and attached.chars > 0
    assert kept.ttl == {f"aichatfile:{attached.id}": chat_files.CHAT_FILE_TTL_SECONDS}
    model.script = [["billing-1 (10.0.0.5) [1] moves to the new rack in May [f1]."]]

    events = await run(installed, owner, asking("when does billing-1 move?", attached.id))

    result = events[-1]["result"]
    assert result["found"] is True
    assert [s["title"] for s in result["sources"]] == ["Billing servers"]
    assert [f["filename"] for f in result["file_sources"]] == ["draft.txt"]
    system, asked = model.streams[-1][0], model.streams[-1][-1]
    assert ATTACHED_FILE_RULES in system["content"]
    # The file and the pages, both in what the model reads.
    assert '<file_source n="f1" title="draft.txt">' in asked["content"]
    assert "new rack in May" in asked["content"]
    assert "10.0.0.5" in asked["content"]


async def test_an_answer_from_the_file_alone_is_grounded_when_the_wiki_has_nothing(
    installed: AsyncSession, model: Model, kept: KeptFiles
) -> None:
    owner, _, _ = await _setup(installed)
    attached = await chat_files.read_upload(owner, "notes.txt", b"The meeting is on Friday.")
    model.script = [["The meeting is on Friday [f1]."]]

    events = await run(installed, owner, asking("zqxv meeting day?", attached.id))

    result = events[-1]["result"]
    assert result["found"] is True
    assert result["sources"] == []
    assert [f["n"] for f in result["file_sources"]] == [1]


async def test_another_persons_or_an_expired_file_is_refused(
    installed: AsyncSession, model: Model, kept: KeptFiles
) -> None:
    owner, _, _ = await _setup(installed)
    other = await _user(installed, "other")
    attached = await chat_files.read_upload(owner, "notes.txt", b"Private words.")

    with pytest.raises(BadRequestError) as refused:
        await ChatService(installed, other).begin(asking("what is in it?", attached.id))
    assert refused.value.code == "chat_file_expired"
    kept.data.clear()
    with pytest.raises(BadRequestError) as expired:
        await ChatService(installed, owner).begin(asking("what is in it?", attached.id))
    assert expired.value.code == "chat_file_expired"
    assert expired.value.details == {"file_id": str(attached.id)}


async def test_a_file_that_cannot_be_read_is_refused_with_its_reason(
    installed: AsyncSession, kept: KeptFiles
) -> None:
    owner, _, _ = await _setup(installed)
    with pytest.raises(BadRequestError) as kind:
        await chat_files.read_upload(owner, "photo.jpg", b"\xff\xd8\xff")
    assert kind.value.code == "unsupported_chat_file"
    with pytest.raises(BadRequestError) as empty:
        await chat_files.read_upload(owner, "blank.txt", b"   ")
    assert empty.value.code == "chat_file_empty"
    assert kept.data == {}


def test_a_mark_to_a_file_not_offered_is_dropped() -> None:
    offered = [FileSource(n=1, filename="a.txt", excerpt="")]
    result = finish("Yes [f1], and no [f9].", "answer", [], [], files=offered)
    assert result.found and result.answer == "Yes [f1], and no."
    assert [f.n for f in result.file_sources] == [1]
    assert not finish("Yes [f9].", "answer", [], [], files=offered).found


def _long(*special: str) -> chat_files.ChatFileText:
    """A file of 2000 lines: a title, filler rows, and ``special`` lines in its middle."""
    rows = [f"SERVICE-{i} | config-{i} | filler words here" for i in range(2000)]
    rows[1000:1000] = list(special)
    return chat_files.ChatFileText(
        id=None,  # type: ignore[arg-type]
        filename="long.txt",
        text="\n".join(["Title of the parameter table", *rows]),
    )


def test_a_long_file_gives_its_opening_and_the_rows_each_question_asks_about() -> None:
    file = _long(
        "INTEGRATION-SERVICE | integration-configmap | INTEGRATION_SERVER_PORT: 8080",
        "BILLING-SERVICE | billing-configmap | deadline is 30 June",
    )
    [(name, read)] = chat_files.passages(
        [file], ["configmap integration", "deadline", "parameter table"], total_chars=6000
    )

    assert name == "long.txt"
    assert read.startswith("Title of the parameter table\nSERVICE-0")
    # Each question gets its row, wherever it is; what was left out is marked.
    assert "INTEGRATION_SERVER_PORT: 8080" in read
    assert "deadline is 30 June" in read
    assert "\n...\n" in read
    assert len(read) <= 6000
    short = [chat_files.ChatFileText(id=None, filename="s.txt", text="short")]  # type: ignore[arg-type]
    assert chat_files.passages(short, ["x"]) == [("s.txt", "short")]


def test_a_question_the_file_does_not_mention_and_a_full_budget_read_its_start() -> None:
    file = _long("BILLING-SERVICE | billing-configmap | deadline is 30 June")
    assert chat_files.passages([], ["x"]) == []
    # Nothing of it is about "zebra" (or nothing is asked): as much of its start as fits.
    [(_, read)] = chat_files.passages([file], ["zebra"], total_chars=6000)
    assert read == file.text[:6000]
    [(_, nothing)] = chat_files.passages([file], [" "], total_chars=6000)
    assert nothing == file.text[:6000]
    # The opening fills the room: the deadline does not fit after it.
    [(_, tight)] = chat_files.passages([file], ["deadline"], total_chars=1210)
    assert tight == file.text[:1210]


class BrokenRedis:
    """A Redis that fails at one call (``set``, ``get`` or ``expire``)."""

    def __init__(self, failing: str, kept: KeptFiles | None = None) -> None:
        self.failing = failing
        self.kept = kept or KeptFiles()

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        if self.failing == "set":
            raise ConnectionError("down")
        await self.kept.set(key, value, ex=ex)

    async def get(self, key: str) -> str | None:
        if self.failing == "get":
            raise ConnectionError("down")
        return await self.kept.get(key)

    async def expire(self, key: str, seconds: int) -> None:
        if self.failing == "expire":
            raise ConnectionError("down")


async def test_redis_being_down_is_a_plain_refusal_not_a_crash(
    installed: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.exceptions import ServiceUnavailableError

    owner, _, _ = await _setup(installed)
    monkeypatch.setattr(chat_files, "get_redis", lambda: BrokenRedis("set"))
    with pytest.raises(ServiceUnavailableError):
        await chat_files.read_upload(owner, "a.txt", b"words")

    store = KeptFiles()
    monkeypatch.setattr(chat_files, "get_redis", lambda: store)
    attached = await chat_files.read_upload(owner, "a.txt", b"words")
    monkeypatch.setattr(chat_files, "get_redis", lambda: BrokenRedis("get", store))
    with pytest.raises(ServiceUnavailableError):
        await chat_files.load(owner, [attached.id])
    # Keeping it a day longer is a nicety: failing at that still reads the file.
    monkeypatch.setattr(chat_files, "get_redis", lambda: BrokenRedis("expire", store))
    [read] = await chat_files.load(owner, [attached.id, attached.id])
    assert read.text == "words"


async def test_the_questions_in_an_attached_file_are_searched_in_the_wiki(
    installed: AsyncSession, model: Model, kept: KeptFiles
) -> None:
    from app.modules.ai.skills import SEVERAL_QUESTIONS_RULES

    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing servers", "billing-1 10.0.0.5, billing-2 10.0.0.6")
    await _page(pages, space, owner, "Backup schedule", "Nightly backups run at 02:00 to MinIO")
    test = await chat_files.read_upload(
        owner,
        "test.txt",
        b"Question 1: Where is billing-1?\n\nQuestion 2: When do the nightly backups run?",
    )
    model.script = [["**Question 1** - 10.0.0.5 [1]. **Question 2** - 02:00 [2] [f1]."]]

    # The message itself names nothing the wiki holds.
    events = await run(installed, owner, asking("answer the test in the file", test.id))

    result = events[-1]["result"]
    assert {s["title"] for s in result["sources"]} == {"Billing servers", "Backup schedule"}
    assert SEVERAL_QUESTIONS_RULES in model.streams[-1][0]["content"]


def test_a_file_without_numbered_questions_is_searched_by_its_opening_words() -> None:
    files = [
        chat_files.ChatFileText(id=None, filename="a.txt", text="Draft  plan\nfor billing"),  # type: ignore[arg-type]
        chat_files.ChatFileText(id=None, filename="b.txt", text="Draft  plan\nfor billing"),  # type: ignore[arg-type]
        chat_files.ChatFileText(id=None, filename="c.txt", text=""),  # type: ignore[arg-type]
    ]
    assert chat_files.queries(files, 10) == ["Draft plan"]


async def test_a_spreadsheet_is_kept_row_by_row(installed: AsyncSession, kept: KeptFiles) -> None:
    owner, _, _ = await _setup(installed)
    attached = await chat_files.read_upload(
        owner,
        "params.csv",
        b"Service,File,Parameter\nINTEGRATION-SERVICE,integration-configmap,PORT=8080\n",
    )

    [read] = await chat_files.load(owner, [attached.id])
    assert "INTEGRATION-SERVICE | integration-configmap | PORT=8080" in read.text


async def test_with_a_file_beside_it_an_unanswered_question_is_still_noted(
    installed: AsyncSession, model: Model, kept: KeptFiles
) -> None:
    from sqlalchemy import select

    from app.models.ai_question import AiQuestionGap

    owner, space, pages = await _setup(installed)
    await _page(pages, space, owner, "Billing servers", "billing-1 10.0.0.5, billing-2 10.0.0.6")
    config = await chat_files.read_upload(owner, "config.txt", b"integration-configmap PORT=8080")
    # The note is written in a session of its own, which sees only what is committed.
    await installed.commit()
    model.script = [["NOT_FOUND"]]

    # About the wiki, not the file: the file's words are not searched for.
    events = await run(installed, owner, asking("who owns billing-1?", config.id))

    assert events[-1]["result"]["found"] is False
    gaps = (await installed.execute(select(AiQuestionGap))).scalars().all()
    assert [gap.question for gap in gaps] == ["who owns billing-1?"]
