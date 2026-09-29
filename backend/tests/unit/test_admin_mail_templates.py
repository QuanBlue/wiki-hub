"""The emails: what they say, that they follow the workspace's look, and that
nothing a person typed can break out of the markup."""

from __future__ import annotations

from datetime import UTC, datetime
from email import message_from_bytes

import pytest

from app.modules.admin_mail import email_templates as templates
from app.modules.admin_mail import smtp
from app.modules.admin_mail.email_templates import Brand, Signature

NOW = datetime(2026, 9, 28, 14, 30, tzinfo=UTC)


def _notification(brand: Brand | None = None, **overrides: object) -> tuple[str, str]:
    values: dict[str, object] = {
        "kind": "account",
        "name": "Thanh Quân",
        "email": "quan@example.org",
        "username": None,
        "message": "Please create an account.\nThank you!",
        "received_at": NOW,
        "inbox_url": "https://wiki.example.test/admin/inbox",
    }
    values.update(overrides)
    return templates.request_notification(brand or Brand(), **values)  # type: ignore[arg-type]


class TestBrand:
    def test_uses_the_workspace_blue_by_default(self) -> None:
        brand = Brand.from_settings("WikiHub", None)

        assert (brand.primary, brand.dark, brand.tint) == ("#216fc0", "#1d579b", "#edf6ff")

    @pytest.mark.parametrize(
        ("choice", "primary"),
        [("emerald", "#16a34a"), ("VIOLET", "#7c3aed"), ("slate", "#475569")],
    )
    def test_follows_the_chosen_preset(self, choice: str, primary: str) -> None:
        assert Brand.from_settings("WikiHub", choice).primary == primary

    def test_shades_a_custom_colour_like_the_app_does(self) -> None:
        brand = Brand.from_settings("WikiHub", "#ff0000")

        # 85% / 70% of the colour for the strong shades, a faint tint behind them.
        assert brand.primary == "#d90000"
        assert brand.dark == "#b30000"
        assert brand.tint.startswith("#ff")

    @pytest.mark.parametrize("junk", ["#zzz", "#12", "not-a-colour", ""])
    def test_falls_back_to_the_default_for_an_unusable_colour(self, junk: str) -> None:
        assert Brand.from_settings("WikiHub", junk).primary == "#216fc0"

    def test_the_mark_is_the_workspace_initial(self) -> None:
        assert Brand.from_settings("acme docs", None).initial == "A"


class TestRequestNotification:
    def test_the_html_carries_the_brand_the_details_and_a_signature(self) -> None:
        text, html = _notification(Brand.from_settings("Acme Docs", "emerald"))

        assert "#16a34a" in html  # mark, links and button follow the theme
        assert "Acme Docs" in html
        # The heading, with the requester's own name set apart in the brand colour.
        assert "New account request from " in html
        assert (
            f'<span style="font-family:{templates._FONT};color:#16a34a;">Thanh Quân</span></h1>'
            in html
        )
        assert 'href="mailto:quan@example.org"' in html
        assert "as typed, not verified" in html
        assert "Best regards," in html and "Acme Docs notifications" in html
        assert 'href="https://wiki.example.test/admin/inbox"' in html
        assert ">Open Requests<" in html
        # The plain-text alternative has no colour to speak of - just the words.
        assert text.startswith("New account request from Thanh Quân\n")

    def test_only_the_requesters_name_is_highlighted_not_the_rest_of_the_heading(
        self,
    ) -> None:
        _text, html = _notification(name="Alice")

        assert f'<span style="font-family:{templates._FONT};color:#216fc0;">Alice</span>' in html
        assert (
            f'<span style="font-family:{templates._FONT};color:#216fc0;">New account request'
            not in html
        )

    def test_a_name_that_repeats_a_word_in_the_heading_is_still_highlighted_once(
        self,
    ) -> None:
        # "request" appears both in the fixed label and (here) in the name -
        # only the trailing occurrence, the actual name, must be coloured.
        _text, html = _notification(name="request")

        assert (
            html.count(f'<span style="font-family:{templates._FONT};color:#216fc0;">request</span>')
            == 1
        )

    def test_the_text_alternative_says_the_same_things(self) -> None:
        text, _html = _notification()

        assert "Name: Thanh Quân" in text
        assert "Email: quan@example.org (as typed, not verified)" in text
        assert "Username: -" in text
        assert "Please create an account.\nThank you!" in text
        assert "Open Requests: https://wiki.example.test/admin/inbox" in text
        assert "Best regards," in text
        assert "28 Sep 2026, 14:30 UTC" in text

    def test_line_breaks_in_the_message_survive_in_the_html(self) -> None:
        _text, html = _notification()

        assert "Please create an account.<br>Thank you!" in html

    def test_an_empty_message_says_so(self) -> None:
        text, html = _notification(message="")

        assert "Message:\n(No message was written.)" in text
        assert "No message was written." in html

    def test_without_a_public_address_there_is_no_link_and_no_dead_button(self) -> None:
        text, html = _notification(inbox_url=None)

        assert "Open Requests" not in html
        assert "http" not in text
        assert "Reply to this email to answer them directly." in text

    def test_what_a_person_typed_cannot_break_out_of_the_markup(self) -> None:
        hostile = '<script>alert(1)</script><img src=x onerror=alert(2)> "quoted" & more'
        _text, html = _notification(name=hostile, message=hostile, username=hostile)

        assert "<script>" not in html
        assert "<img" not in html
        assert "&lt;script&gt;" in html
        assert "&quot;quoted&quot; &amp; more" in html

    def test_a_hostile_address_cannot_inject_an_attribute(self) -> None:
        _text, html = _notification(email='a@b.test" onclick="alert(1)')

        assert 'onclick="alert' not in html


class TestAccountDetails:
    def _render(self, *, created: bool = True, login_url: str | None = "https://w.test/login"):
        return templates.account_details(
            Brand.from_settings("Acme Docs", "indigo"),
            created=created,
            name="Alice  Nguyen",
            username="alice",
            password="Zx7kQm2Rt9WpAb4c",
            login_url=login_url,
            signature=Signature(
                name="Ada Admin",
                title="Administrator, Acme Docs",
                email="ada@example.test",
                url="https://w.test",
            ),
        )

    def test_gives_the_sign_in_details_a_button_and_a_signature(self) -> None:
        text, html = self._render()

        assert "Your account is ready" in html
        assert "Zx7kQm2Rt9WpAb4c" in html and "alice" in html
        assert 'href="https://w.test/login"' in html and ">Sign in<" in html
        assert "Ada Admin" in html and "Administrator, Acme Docs" in html
        assert 'href="mailto:ada@example.test"' in html
        assert "#4f46e5" in html
        assert "Hello Alice Nguyen," in text  # stray spaces in the name tidied
        assert "Username: alice\nTemporary password: Zx7kQm2Rt9WpAb4c" in text
        assert "Best regards,\nAda Admin\nAdministrator, Acme Docs" in text
        assert "ada@example.test · https://w.test" in text

    def test_says_it_was_a_reset_when_it_was(self) -> None:
        text, html = self._render(created=False)

        assert "Your password was reset" in html
        assert "reset the password for your account" in text

    def test_reminds_them_to_change_it(self) -> None:
        text, _html = self._render()

        assert "change this password after you sign in" in text

    def test_no_sign_in_link_when_the_address_is_unknown(self) -> None:
        text, html = self._render(login_url=None)

        assert ">Sign in<" not in html
        assert "Sign in:" not in text


class TestDelivery:
    def test_a_message_with_html_is_multipart_and_keeps_the_text_fallback(self) -> None:
        config = smtp.SmtpConfig(
            host="127.0.0.1",
            port=25,
            security="none",
            username="ops@example.test",
            password="x",
            email="ops@example.test",
            display_name="Thanh Quân",
        )
        text, html = _notification()

        message = smtp.build_message(
            config, subject="Hello", body=text, html=html, to="alice@example.org"
        )
        parsed = message_from_bytes(message.as_bytes())

        assert parsed.get_content_type() == "multipart/alternative"
        kinds = [part.get_content_type() for part in parsed.get_payload()]
        assert kinds == ["text/plain", "text/html"]
        assert parsed["To"] == "alice@example.org"
        html_part = parsed.get_payload()[1].get_payload(decode=True).decode()
        assert "Thanh Quân" in html_part  # non-ASCII survives encoding

    def test_without_html_it_stays_a_plain_message(self) -> None:
        config = smtp.SmtpConfig(
            host="h", port=25, security="none", username="", password="", email="ops@example.test"
        )

        message = smtp.build_message(config, subject="Hi", body="text")

        assert message.get_content_type() == "text/plain"


class TestSimpleLook:
    def test_the_card_has_no_coloured_top_border(self) -> None:
        _text, html = _notification()

        assert "border-top:4px" not in html
        assert "border-left:4px" not in html
        # The brand colour is kept for the mark, links and the one button.
        assert html.count("#216fc0") >= 3

    def test_there_is_no_eyebrow_label_above_the_title(self) -> None:
        text, html = _notification()

        assert "text-transform:uppercase" not in html
        assert "ACCOUNT REQUEST" not in text
