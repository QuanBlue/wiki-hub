"""The weather of a place from Open-Meteo: what is sent, and how the reading is told."""

from __future__ import annotations

import httpx
import pytest

from app.modules.ai import weather
from app.modules.ai.weather import clean_place, get_weather, summary

CURRENT = {
    "time": "2026-10-16T12:00",
    "temperature_2m": 31.2,
    "apparent_temperature": 36.0,
    "relative_humidity_2m": 62,
    "wind_speed_10m": 11.5,
    "precipitation": 0.0,
    "weather_code": 2,
}
DAILY = {
    "temperature_2m_min": [26.1],
    "temperature_2m_max": [33.4],
    "precipitation_probability_max": [40],
}


def serving(monkeypatch: pytest.MonkeyPatch, handler) -> list[httpx.Request]:
    seen: list[httpx.Request] = []
    real = httpx.AsyncClient

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(
        weather.httpx,
        "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(respond), **kw),
    )
    return seen


def open_meteo(request: httpx.Request) -> httpx.Response:
    if "geocoding" in request.url.host:
        return httpx.Response(
            200,
            json={
                "results": [
                    {"name": "Cam Ranh", "country": "Vietnam", "latitude": 11.9, "longitude": 109.2}
                ]
            },
        )
    return httpx.Response(200, json={"current": CURRENT, "daily": DAILY})


@pytest.mark.parametrize(
    ("typed", "sent"),
    [
        ("Cam Ranh", "Cam Ranh"),
        ("  Hà Nội, Vietnam. ", "Hà Nội, Vietnam"),
        ("Cam Ranh <b>now</b>", "Cam Ranh b now b"),
        ("x", ""),
        ("12345", ""),
        ("", ""),
    ],
)
def test_only_a_place_name_is_ever_sent_out(typed: str, sent: str) -> None:
    assert clean_place(typed) == sent


def test_a_reading_is_told_in_plain_lines_with_units() -> None:
    text = summary("Cam Ranh, Vietnam", CURRENT, DAILY)

    assert "partly cloudy" in text and "31.2°C (feels like 36.0°C)" in text
    assert "Humidity: 62%" in text and "Wind: 11.5 km/h" in text
    assert "Today: 26.1°C to 33.4°C, chance of rain 40%" in text


def test_a_reading_with_gaps_says_so_instead_of_inventing_numbers() -> None:
    text = summary("Nowhere", {"weather_code": 12345}, {})

    assert "unknown" in text and "n/a" in text


async def test_the_place_is_found_and_its_weather_read(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = serving(monkeypatch, open_meteo)

    results = await get_weather("Cam Ranh")

    [result] = results
    assert result.title == "Weather in Cam Ranh, Vietnam (Open-Meteo)"
    assert "31.2°C" in result.content and result.url == "https://open-meteo.com/"
    assert [r.url.host for r in seen] == [
        "geocoding-api.open-meteo.com",
        "api.open-meteo.com",
    ]
    assert seen[0].url.params["name"] == "Cam Ranh"


async def test_nothing_is_asked_for_a_place_that_is_not_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = serving(monkeypatch, open_meteo)

    assert await get_weather("12345") == []
    assert seen == []


async def test_a_place_nobody_knows_has_no_weather(monkeypatch: pytest.MonkeyPatch) -> None:
    serving(monkeypatch, lambda request: httpx.Response(200, json={}))

    assert await get_weather("Atlantis") == []


async def test_a_reading_without_current_values_is_no_reading(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if "geocoding" in request.url.host:
            return open_meteo(request)
        return httpx.Response(200, json={"daily": DAILY})

    serving(monkeypatch, handler)

    assert await get_weather("Cam Ranh") == []


@pytest.mark.parametrize("status", [500, 429])
async def test_a_service_that_fails_gives_no_weather_rather_than_an_error(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    serving(monkeypatch, lambda request: httpx.Response(status))

    assert await get_weather("Cam Ranh") == []
