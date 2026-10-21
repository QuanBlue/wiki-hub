"""Measure what the AI assistant would read to answer a set of questions.

For every question, lists the pages ``SearchService.answer_passages`` hands the
model and checks them against the pages that *should* be there. Run once with the
knowledge graph off and once with it on, to see whether related pages help:

    python scripts/eval_answers.py scripts/eval_questions.local.json
    python scripts/eval_answers.py scripts/eval_questions.local.json --related 0 2 3

Nothing is written: the graph setting is overridden for the run only, and no
question reaches the chat model. The questions file is a JSON list of::

    {"question": "...", "expected": ["SPACEKEY/page-slug", "SPACE/copied-page*", ...],
     "user": "admin"}

``user`` (optional, default ``--user``) is who asks, so restricted pages count as
they would for that person. Keep a file of real questions out of git (``*.local.json``
is ignored): it describes what the wiki holds. ``eval_questions.example.json`` shows
the format on the DEMO space.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import fnmatch
import json
import sys
from pathlib import Path

from sqlalchemy import select

from app.db.session import session_scope
from app.models.user import User
from app.modules.ai.config import AIConfig, load_config
from app.modules.search import service as search_service
from app.modules.search.service import SearchService

#: An expected page: ``"SPACE/slug"``, a pattern (``"DEVOPS/pmo*"``: any copy of a
#: page), or a list of those when any one of them answers it.
Expected = str | list[str]


def _matches(expected: Expected, page: str) -> bool:
    patterns = [expected] if isinstance(expected, str) else expected
    return any(fnmatch.fnmatchcase(page, pattern) for pattern in patterns)


@dataclasses.dataclass
class Outcome:
    question: str
    found: list[str]
    expected: list[Expected]
    chars: int

    def missing(self) -> list[Expected]:
        return [e for e in self.expected if not any(_matches(e, page) for page in self.found)]

    @property
    def recall(self) -> float:
        if not self.expected:
            return 1.0
        return 1 - len(self.missing()) / len(self.expected)


async def _run(questions: list[dict], default_user: str, related: int) -> list[Outcome]:
    async def with_related(session) -> AIConfig:  # type: ignore[no-untyped-def]
        config = await load_config(session)
        tuning = dataclasses.replace(config.tuning, graph_related_pages=related)
        return dataclasses.replace(config, tuning=tuning)

    original = search_service.load_config
    search_service.load_config = with_related  # type: ignore[assignment]
    outcomes: list[Outcome] = []
    try:
        async with session_scope() as session:
            users: dict[str, User] = {}
            for item in questions:
                name = item.get("user") or default_user
                if name not in users:
                    user = await session.scalar(select(User).where(User.username == name))
                    if user is None:
                        sys.exit(f"No such user: {name}")
                    users[name] = user
                passages = await SearchService(session).answer_passages(
                    item["question"], users[name]
                )
                outcomes.append(
                    Outcome(
                        question=item["question"],
                        found=[f"{p.page.space_key}/{p.page.slug}" for p in passages],
                        expected=list(item.get("expected", [])),
                        chars=sum(len(p.text) for p in passages),
                    )
                )
    finally:
        search_service.load_config = original  # type: ignore[assignment]
    return outcomes


def _report(related: int, outcomes: list[Outcome], *, verbose: bool) -> None:
    print(f"\n=== related pages: {related} ===")
    for outcome in outcomes:
        mark = "ok " if outcome.recall == 1.0 else "-- "
        print(f"{mark}{outcome.recall:4.0%}  {outcome.question}")
        if verbose or outcome.recall < 1.0:
            missing = [str(page) for page in outcome.missing()]
            print(f"        read:    {', '.join(outcome.found) or '(nothing)'}")
            if missing:
                print(f"        missing: {', '.join(missing)}")
    count = len(outcomes) or 1
    recall = sum(outcome.recall for outcome in outcomes) / count
    complete = sum(outcome.recall == 1.0 for outcome in outcomes)
    pages = sum(len(outcome.found) for outcome in outcomes) / count
    chars = sum(outcome.chars for outcome in outcomes) / count
    print(
        f"recall {recall:.0%} | fully answered {complete}/{len(outcomes)} | "
        f"{pages:.1f} pages, {chars:.0f} chars per question"
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("questions", type=Path)
    parser.add_argument("--user", default="admin", help="who asks, when a question names nobody")
    parser.add_argument(
        "--related",
        type=int,
        nargs="+",
        default=[0, 2],
        help="graph_related_pages values to compare (0 = graph off)",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="list pages for every question"
    )
    args = parser.parse_args()
    questions = json.loads(args.questions.read_text(encoding="utf-8"))
    for related in args.related:
        _report(related, await _run(questions, args.user, related), verbose=args.verbose)


if __name__ == "__main__":
    asyncio.run(main())
