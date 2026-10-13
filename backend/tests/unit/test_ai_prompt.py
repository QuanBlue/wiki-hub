"""What the summary prompt asks of the model, and what it is shown."""

from __future__ import annotations

import uuid

from app.modules.ai.service import summary_user_message
from app.modules.ai.skills import DEFAULT_SUMMARY_INSTRUCTIONS, summary_system_prompt
from app.schemas.ai import SummaryAttachment


def _file(name: str) -> SummaryAttachment:
    return SummaryAttachment(
        id=uuid.uuid4(), filename=name, content_type="application/octet-stream"
    )


def test_the_model_is_shown_the_page_and_the_names_of_its_attached_files() -> None:
    message = summary_user_message(
        "Title", "Body text", [_file("one.pptx"), _file("Install k3s by CLI.docx")]
    )

    assert message == (
        "Title: Title\n<page>\nBody text\n</page>\n<files>\none.pptx\nInstall k3s by CLI.docx\n</files>"
    )


def test_a_page_without_attachments_has_no_files_block() -> None:
    assert (
        summary_user_message("Title", "Body text", []) == "Title: Title\n<page>\nBody text\n</page>"
    )


def test_it_is_told_to_name_files_exactly_and_to_treat_their_names_as_data() -> None:
    prompt = summary_system_prompt("Be brief.")

    assert "exact name" in prompt
    assert "not bold" in prompt
    assert "<files>" in prompt
    assert "untrusted" in prompt


def test_every_bullet_is_one_sentence_so_the_layout_matches_across_languages() -> None:
    assert "one short sentence ending in a full stop" in DEFAULT_SUMMARY_INSTRUCTIONS
    assert "whatever language you write in" in DEFAULT_SUMMARY_INSTRUCTIONS
