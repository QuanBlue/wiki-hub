"""The weather of a named place, from real measurements.

A web search finds pages *about* the weather; the numbers on them are drawn by scripts, so
reading the page gives none. Open-Meteo is a public service that answers with the numbers
themselves and needs no key. All that leaves WikiHub is the name of a place.
"""

from __future__ import annotations

import re

import httpx

from app.core.logging import get_logger
from app.modules.ai.websearch import WebResult

logger = get_logger(__name__)

_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
_FORECAST = "https://api.open-meteo.com/v1/forecast"
_PROJECT = "https://open-meteo.com/"
_TIMEOUT_SECONDS = 8.0

#: Letters (any script), spaces, and the marks in a place name; nothing else is sent.
_NOT_PLACE = re.compile(r"[^\w\s,.'-]", re.UNICODE)

#: What the weather code (WMO) means.
_CONDITIONS = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "rime fog",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    56: "freezing drizzle",
    57: "heavy freezing drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    66: "freezing rain",
    67: "heavy freezing rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    77: "snow grains",
    80: "light rain showers",
    81: "rain showers",
    82: "violent rain showers",
    85: "snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with hail",
    99: "thunderstorm with heavy hail",
}


def clean_place(text: str) -> str:
    """A place name safe to send out; ``""`` when there is nothing usable in it."""
    place = " ".join(_NOT_PLACE.sub(" ", text).split())[:80].strip(" ,.")
    return place if len(re.findall(r"[^\W\d_]", place, re.UNICODE)) >= 2 else ""


def _number(value: object, unit: str = "") -> str:
    return f"{value}{unit}" if isinstance(value, int | float) else "n/a"


def summary(place: str, current: dict, daily: dict) -> str:
    """The reading as a few plain lines a person (or a model) can quote."""
    code = current.get("weather_code")
    lines = [
        f"{place}, now ({current.get('time', '')}):",
        f"- Conditions: {_CONDITIONS.get(code, 'unknown') if isinstance(code, int) else 'unknown'}",
        f"- Temperature: {_number(current.get('temperature_2m'), '°C')} "
        f"(feels like {_number(current.get('apparent_temperature'), '°C')})",
        f"- Humidity: {_number(current.get('relative_humidity_2m'), '%')}",
        f"- Wind: {_number(current.get('wind_speed_10m'), ' km/h')}",
        f"- Precipitation: {_number(current.get('precipitation'), ' mm')}",
    ]

    def first(key: str) -> object:
        values = daily.get(key)
        return values[0] if isinstance(values, list) and values else None

    lines.append(
        f"- Today: {_number(first('temperature_2m_min'), '°C')} to "
        f"{_number(first('temperature_2m_max'), '°C')}, chance of rain "
        f"{_number(first('precipitation_probability_max'), '%')}"
    )
    return "\n".join(lines)


async def get_weather(place_text: str) -> list[WebResult]:
    """One result holding the current weather of the place, or none when it cannot be had."""
    place = clean_place(place_text)
    if not place:
        return []
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as http:
            found = await http.get(_GEOCODE, params={"name": place, "count": 1, "language": "en"})
            found.raise_for_status()
            matches = found.json().get("results") or []
            if not matches:
                return []
            where = matches[0]
            forecast = await http.get(
                _FORECAST,
                params={
                    "latitude": where["latitude"],
                    "longitude": where["longitude"],
                    "current": (
                        "temperature_2m,relative_humidity_2m,apparent_temperature,"
                        "precipitation,weather_code,wind_speed_10m"
                    ),
                    "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                    "timezone": "auto",
                    "forecast_days": 1,
                },
            )
            forecast.raise_for_status()
            body = forecast.json()
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        # Never log the place: only what failed.
        logger.warning("ai_weather_failed", error=type(exc).__name__)
        return []
    name = ", ".join(str(part) for part in (where.get("name"), where.get("country")) if part)
    current = body.get("current") or {}
    if not current:
        return []
    text = summary(name or place, current, body.get("daily") or {})
    return [
        WebResult(
            title=f"Weather in {name or place} (Open-Meteo)",
            url=_PROJECT,
            snippet=text.splitlines()[1] if len(text.splitlines()) > 1 else text,
            content=text,
        )
    ]
