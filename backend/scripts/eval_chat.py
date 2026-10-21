"""Ask the AI assistant a set of questions end to end and record how it did.

Unlike ``eval_answers.py`` (which only checks which pages are handed to the model), this runs
each question through the real chat - routing, retrieval, the model, the second look, web search -
and writes what came back with how long it took:

    python scripts/eval_chat.py scripts/eval_reasoning.local.json --out /tmp/eval_chat.json

It calls the configured chat model (and, where the question goes there, the web search), so it
costs a little and takes a while. Nothing is written to the wiki.

A question file is a JSON list of::

    {"question": "...",                       # or "turns": ["first", "follow-up"]
     # pages that should be sources (a pattern, or a list of which any one will do)
     "expected": ["SPACE/slug", "SPACE/copy*", ["either/this", "or/that"]],
     "basis": "wiki",                         # expected: wiki | web | clarify | not_found | any
     "must_contain": ["8443"],                # words the answer must hold (any case)
     "note": "why this question is asked",
     "user": "admin"}

Questions asked as ``turns`` are one conversation: each follow-up sees the earlier answers.
"""

from __future__ import annotations

import argparse
import asyncio
import fnmatch
import json
import sys
import time
from pathlib import Path

from sqlalchemy import select

from app.core import rate_limit
from app.db.session import session_scope
from app.models.user import User
from app.modules.ai.chat import ChatService
from app.schemas.ai import ChatMessage, ChatRequest


def _matches(expected, page: str) -> bool:
    patterns = [expected] if isinstance(expected, str) else expected
    return any(fnmatch.fnmatchcase(page, pattern) for pattern in patterns)


def _page(source: dict) -> str:
    return f"{source['space_key']}/{source['slug']}"


async def ask(session, user, turns: list[str], detail: str) -> dict:
    """One conversation; the result of the last turn, and the time it took."""
    history: list[ChatMessage] = []
    result: dict = {}
    first_word = total = 0.0
    for text in turns:
        history.append(ChatMessage(role="user", content=text))
        started = time.perf_counter()
        first_word = 0.0
        try:
            turn = await ChatService(session, user).begin(
                ChatRequest(messages=list(history), detail=detail)
            )
            events = []
            async for event in turn.events():
                if event["type"] == "delta" and not first_word:
                    first_word = time.perf_counter() - started
                events.append(event)
        except Exception as exc:  # noqa: BLE001 - a failed question is a result, not a crash
            total = time.perf_counter() - started
            return {"error": f"{type(exc).__name__}: {exc}", "seconds": round(total, 1)}
        total = time.perf_counter() - started
        last = events[-1] if events else {}
        result = last.get("result") or {"error": last.get("code", "no result")}
        history.append(ChatMessage(role="assistant", content=result.get("answer") or "(none)"))
    result["seconds"] = round(total, 1)
    result["first_word_seconds"] = round(first_word, 1)
    return result


def judge(case: dict, result: dict) -> dict:
    """Automatic checks against what the question says it expects."""
    checks: dict[str, bool] = {}
    if "error" in result:
        return {"passed": False, "checks": {"no_error": False}}
    pages = [_page(s) for s in result.get("sources", [])]
    related = [_page(s) for s in result.get("related", [])]
    expected = case.get("expected") or []
    if expected:
        missing = [e for e in expected if not any(_matches(e, p) for p in pages + related)]
        checks["expected_pages_read"] = not missing
        checks["expected_pages_cited"] = all(any(_matches(e, p) for p in pages) for e in expected)
    want = case.get("basis", "any")
    if want != "any":
        if want == "not_found":
            checks["basis"] = not result.get("found")
        else:
            checks["basis"] = bool(result.get("found")) and result.get("basis") == want
    answer = (result.get("answer") or "").lower()
    for word in case.get("must_contain", []):
        checks[f"has_{word}"] = word.lower() in answer
    # "cited" is a softer check than "read": a page can feed the answer without being cited.
    hard = {k: v for k, v in checks.items() if k != "expected_pages_cited"}
    return {"passed": all(hard.values()) if hard else True, "checks": checks}


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("questions", nargs="+", type=Path)
    parser.add_argument("--user", default="admin")
    parser.add_argument("--detail", default="normal", choices=("brief", "normal", "detailed"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--only", type=int, nargs="*", help="run only these question numbers")
    args = parser.parse_args()

    # A long run must neither stop at the per-hour limit meant for people nor use up the
    # quota of the account it runs as (that person could not ask anything for an hour).
    async def no_limit(_key: str, _rule: str) -> None:
        return None

    rate_limit.enforce = no_limit  # type: ignore[assignment]
    cases: list[dict] = []
    for path in args.questions:
        cases.extend(json.loads(path.read_text(encoding="utf-8")))
    started_at = time.strftime("%Y-%m-%d %H:%M:%S")
    out: list[dict] = []
    for number, case in enumerate(cases, start=1):
        if args.only and number not in args.only:
            continue
        turns = case.get("turns") or [case["question"]]
        async with session_scope() as session:
            user = await session.scalar(
                select(User).where(User.username == case.get("user", args.user))
            )
            result = await ask(session, user, turns, args.detail)
        verdict = judge(case, result)
        out.append({"n": number, "case": case, "result": result, "verdict": verdict})
        print(
            f"{number:>3} {'PASS' if verdict['passed'] else 'FAIL'} {result.get('seconds', 0):>6}s "
            f"{result.get('basis', result.get('error', '?')):<8} {turns[-1][:70]}",
            flush=True,
        )
        args.out.write_text(
            json.dumps({"started_at": started_at, "results": out}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
    passed = sum(1 for item in out if item["verdict"]["passed"])
    total_seconds = sum(item["result"].get("seconds", 0) for item in out)
    print(f"\n{passed}/{len(out)} passed, {total_seconds:.0f}s in total", file=sys.stderr)


asyncio.run(main())
