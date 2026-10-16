import pytest

from app.core.exceptions import ServiceUnavailableError
from app.modules.ai import client
from app.modules.ai.client import Usage, parse_usage
from app.modules.ai.config import AIConfig


def test_parse_usage_reads_the_gateway_object() -> None:
    assert parse_usage({"prompt_tokens": 10, "completion_tokens": 4}) == Usage(10, 4)
    assert parse_usage({"prompt_tokens": 10, "completion_tokens": 4}).total_tokens == 14


@pytest.mark.parametrize(
    "raw", [None, "x", [], {}, {"prompt_tokens": True, "completion_tokens": 1}]
)
def test_parse_usage_ignores_anything_unusable(raw) -> None:
    assert parse_usage(raw) is None


def test_parse_usage_tolerates_one_missing_field_and_negatives() -> None:
    assert parse_usage({"prompt_tokens": 7}) == Usage(7, 0)
    assert parse_usage({"prompt_tokens": -3, "completion_tokens": 2}) == Usage(0, 2)


def _config() -> AIConfig:
    return AIConfig(base_url="http://x", api_key="k", model="m", enabled=True)


@pytest.mark.asyncio
async def test_a_cut_off_reply_adds_up_both_attempts(monkeypatch) -> None:
    calls = [
        (
            {"finish_reason": "length", "message": {"content": "par"}},
            {"prompt_tokens": 5, "completion_tokens": 5},
        ),
        (
            {"finish_reason": "stop", "message": {"content": " whole "}},
            {"prompt_tokens": 5, "completion_tokens": 9},
        ),
    ]

    async def fake(*_a):
        return calls.pop(0)

    monkeypatch.setattr(client, "_complete", fake)
    reply = await client.chat_with_usage(_config(), [], max_tokens=10)
    assert reply.text == "whole"
    assert reply.usage == Usage(10, 14)


@pytest.mark.asyncio
async def test_missing_usage_stays_none_rather_than_guessed(monkeypatch) -> None:
    async def fake(*_a):
        return {"finish_reason": "stop", "message": {"content": "hi"}}, None

    monkeypatch.setattr(client, "_complete", fake)
    reply = await client.chat_with_usage(_config(), [])
    assert reply.usage is None
    assert await client.chat(_config(), []) == "hi"


@pytest.mark.asyncio
async def test_an_empty_reply_is_still_an_error(monkeypatch) -> None:
    async def fake(*_a):
        return {"finish_reason": "stop", "message": {"content": " "}}, {"prompt_tokens": 1}

    monkeypatch.setattr(client, "_complete", fake)
    with pytest.raises(ServiceUnavailableError):
        await client.chat_with_usage(_config(), [])
