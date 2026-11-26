from __future__ import annotations

from app.modules.ai.service import _parse_slide_deck
from app.modules.ai.skills import slides_system_prompt


def test_slides_system_prompt_respects_language() -> None:
    prompt_default = slides_system_prompt(None)
    assert "same language as the page" in prompt_default

    prompt_vi = slides_system_prompt("vi")
    assert "Vietnamese" in prompt_vi

    prompt_en = slides_system_prompt("en")
    assert "English" in prompt_en


def test_parse_slide_deck_from_json_and_fenced_json() -> None:
    raw = """```json
    {
      "slides": [
        {
          "title": "Architecture Overview",
          "subtitle": "Core components",
          "bullets": ["**FastAPI** backend", "**PostgreSQL** storage"],
          "callout": "99.9% uptime target",
          "speaker_notes": "Walk through the request lifecycle.",
          "layout": "bullets"
        },
        {
          "title": "Next Steps",
          "bullets": ["Rollout to production"],
          "layout": "section"
        }
      ]
    }
    ```"""
    slides = _parse_slide_deck(raw, "Fallback Title")
    assert len(slides) == 2
    assert slides[0].title == "Architecture Overview"
    assert slides[0].subtitle == "Core components"
    assert slides[0].bullets == ["**FastAPI** backend", "**PostgreSQL** storage"]
    assert slides[0].callout == "99.9% uptime target"
    assert slides[0].speaker_notes == "Walk through the request lifecycle."
    assert slides[0].layout == "bullets"
    assert slides[1].layout == "section"


def test_parse_slide_deck_fallback_on_non_json() -> None:
    raw = "- Point one\n- Point two"
    slides = _parse_slide_deck(raw, "Fallback Page Title")
    assert len(slides) == 1
    assert slides[0].title == "Fallback Page Title"
    assert slides[0].bullets == ["Point one", "Point two"]
