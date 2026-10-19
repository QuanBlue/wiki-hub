"""Importing by a Google Sheets or Google Docs link: which links count, and the download."""

from __future__ import annotations

import httpx
import pytest

from app.core.exceptions import PayloadTooLargeError, ServiceUnavailableError
from app.modules.document_import.google_links import (
    GoogleLinkError,
    export_for,
    fetch_google_file,
    filename_from_disposition,
)

FILE_ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
SHEET = f"https://docs.google.com/spreadsheets/d/{FILE_ID}/edit"
DOC = f"https://docs.google.com/document/d/{FILE_ID}/edit?tab=t.0"


class TestLinks:
    @pytest.mark.parametrize(
        "link",
        [
            f"https://docs.google.com/spreadsheets/d/{FILE_ID}/edit#gid=0",
            f"https://docs.google.com/spreadsheets/d/{FILE_ID}",
            f"docs.google.com/spreadsheets/d/{FILE_ID}/edit?usp=sharing",
        ],
    )
    def test_a_shared_sheet_maps_to_the_xlsx_export(self, link):
        export = export_for(link)
        assert export.url == f"https://docs.google.com/spreadsheets/d/{FILE_ID}/export?format=xlsx"
        assert export.source_format == "xlsx"

    def test_a_published_sheet_uses_the_publish_export(self):
        export = export_for(f"https://docs.google.com/spreadsheets/d/e/2PACX-{FILE_ID}/pubhtml")
        assert export.url == (
            f"https://docs.google.com/spreadsheets/d/e/2PACX-{FILE_ID}/pub?output=xlsx"
        )

    @pytest.mark.parametrize(
        "link",
        [
            DOC,
            f"https://docs.google.com/document/d/{FILE_ID}",
            f"docs.google.com/document/d/{FILE_ID}/edit?usp=sharing",
        ],
    )
    def test_a_shared_doc_maps_to_the_docx_export(self, link):
        export = export_for(link)
        assert export.url == f"https://docs.google.com/document/d/{FILE_ID}/export?format=docx"
        assert export.source_format == "docx"
        assert export.label == "Google Doc"

    def test_a_published_doc_asks_for_the_sharing_link(self):
        with pytest.raises(GoogleLinkError, match="Copy link"):
            export_for(f"https://docs.google.com/document/d/e/2PACX-{FILE_ID}/pub")

    @pytest.mark.parametrize(
        "link",
        [
            "",
            f"https://example.com/spreadsheets/d/{FILE_ID}",
            f"https://docs.google.com.evil.test/spreadsheets/d/{FILE_ID}",
            f"https://docs.google.com/presentation/d/{FILE_ID}/edit",
            f"ftp://docs.google.com/document/d/{FILE_ID}",
        ],
    )
    def test_anything_else_is_refused_before_a_request(self, link):
        with pytest.raises(GoogleLinkError):
            export_for(link)

    def test_the_filename_comes_from_the_download_header(self):
        header = "attachment; filename=\"Bao cao.xlsx\"; filename*=UTF-8''B%C3%A1o%20c%C3%A1o.xlsx"
        assert filename_from_disposition(header) == "Báo cáo.xlsx"
        assert filename_from_disposition('attachment; filename="Plan.docx"') == "Plan.docx"
        assert filename_from_disposition(None) is None


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def _fetch(link: str, handler, *, limit_bytes: int = 1 << 20):
    async with _client(handler) as client:
        return await fetch_google_file(link, limit_bytes=limit_bytes, limit_mb=1, client=client)


class TestFetch:
    async def test_a_public_sheet_is_downloaded_through_googles_redirect(self):
        seen: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(str(request.url))
            if request.url.host == "docs.google.com":
                return httpx.Response(
                    307, headers={"location": "https://doc-0s-sheets.googleusercontent.com/x"}
                )
            return httpx.Response(
                200,
                content=b"PK workbook",
                headers={
                    "content-disposition": "attachment; filename*=UTF-8''K%E1%BA%BF%20ho%E1%BA%A1ch.xlsx"
                },
            )

        name, data, export = await _fetch(SHEET, handler)
        assert (name, data, export.source_format) == ("Kế hoạch.xlsx", b"PK workbook", "xlsx")
        assert seen[0].endswith("/export?format=xlsx")

    async def test_a_public_doc_arrives_as_a_word_file(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path.endswith("/export")
            return httpx.Response(
                200,
                content=b"PK document",
                headers={"content-disposition": 'attachment; filename="Runbook.docx"'},
            )

        name, data, export = await _fetch(DOC, handler)
        assert (name, data) == ("Runbook.docx", b"PK document")
        assert export.content_type.endswith("wordprocessingml.document")

    async def test_a_download_without_a_name_is_named_for_its_kind(self):
        name, _data, _export = await _fetch(DOC, lambda _r: httpx.Response(200, content=b"PK"))
        assert name == "Google Doc.docx"

        def dotted(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, content=b"PK", headers={"content-disposition": 'attachment; filename="Release 1.2"'}
            )

        name, _data, _export = await _fetch(DOC, dotted)
        assert name == "Release 1.2.docx"

    @pytest.mark.parametrize(("link", "label"), [(SHEET, "Google Sheet"), (DOC, "Google Doc")])
    async def test_a_private_file_asks_for_it_to_be_shared(self, link, label):
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                302, headers={"location": "https://accounts.google.com/ServiceLogin?continue=x"}
            )

        with pytest.raises(GoogleLinkError, match="Anyone with the link") as raised:
            await _fetch(link, handler)
        assert raised.value.code == "google_link_not_shared"
        assert label in str(raised.value)

    @pytest.mark.parametrize("status", [401, 403])
    async def test_a_refusal_asks_for_it_to_be_shared(self, status):
        with pytest.raises(GoogleLinkError, match="Anyone with the link"):
            await _fetch(SHEET, lambda _r: httpx.Response(status))

    async def test_an_html_page_instead_of_a_file_is_not_shared(self):
        with pytest.raises(GoogleLinkError, match="Anyone with the link"):
            await _fetch(DOC, lambda _r: httpx.Response(200, text="<html>Sign in</html>"))

    async def test_a_redirect_off_google_is_not_followed(self):
        hosts: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            hosts.append(request.url.host)
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest"})

        with pytest.raises(GoogleLinkError):
            await _fetch(SHEET, handler)
        assert hosts == ["docs.google.com"]

    async def test_endless_redirects_give_up(self):
        def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(302, headers={"location": "https://docs.google.com/again"})

        with pytest.raises(ServiceUnavailableError, match="too many times"):
            await _fetch(SHEET, handler)

    async def test_a_missing_file_is_reported(self):
        with pytest.raises(GoogleLinkError, match="not found"):
            await _fetch(SHEET, lambda _r: httpx.Response(404))

    async def test_another_error_from_google_is_reported_as_unavailable(self):
        with pytest.raises(ServiceUnavailableError, match="HTTP 500"):
            await _fetch(SHEET, lambda _r: httpx.Response(500))

    async def test_a_file_over_the_upload_ceiling_is_refused(self):
        with pytest.raises(PayloadTooLargeError):
            await _fetch(
                SHEET, lambda _r: httpx.Response(200, content=b"PK" + b"0" * 4096), limit_bytes=1024
            )

    async def test_an_unreachable_google_is_reported(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("down", request=request)

        with pytest.raises(ServiceUnavailableError, match="could not reach Google"):
            await _fetch(SHEET, handler)

    async def test_its_own_client_is_closed_afterwards(self, monkeypatch):
        closed: list[bool] = []

        class Client(httpx.AsyncClient):
            async def aclose(self) -> None:
                closed.append(True)
                await super().aclose()

        def make(**kwargs):
            return Client(transport=httpx.MockTransport(lambda _r: httpx.Response(404)), **kwargs)

        monkeypatch.setattr(
            "app.modules.document_import.google_links.httpx.AsyncClient", make
        )
        with pytest.raises(GoogleLinkError):
            await fetch_google_file(SHEET, limit_bytes=1024, limit_mb=1)
        assert closed == [True]
