import html
import io
import re
import tempfile
import urllib.parse
import uuid
import zipfile
from contextlib import suppress
from pathlib import Path
from typing import IO, Any

import anyio
from bs4 import BeautifulSoup
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError, PayloadTooLargeError
from app.core.logging import get_logger

logger = get_logger(__name__)
from app.models.attachment import PageAttachment
from app.models.import_job import ImportArchive, ImportJob, ImportLog
from app.models.page import WikiPage
from app.models.permission import Group, GroupMember, Permission, SpaceGroupPermission
from app.models.restriction import (
    PageGroupRestriction,
    PageRestrictionPermission,
    PageUserRestriction,
)
from app.models.space import Space, SpaceMember, SpaceRole, SpaceVisibility
from app.modules.import_export.confluence import (
    ConfluencePage,
    ConfluenceSpace,
    iter_attachments,
    iter_page_bodies,
    scan_archive,
)
from app.services.storage import ObjectStorage


class ImportCancelled(Exception):
    """Raised when an import job is cancelled by an administrator."""


INVALID_IMPORT_USERNAME = "invalid_user"
_INVALID_IMPORT_USERNAME = re.compile(r"^[0-9a-f]{32}$", re.IGNORECASE)


def _is_invalid_import_username(username: str) -> bool:
    """Return whether Confluence supplied an internal id instead of a name."""
    return bool(_INVALID_IMPORT_USERNAME.fullmatch(username.strip()))


def _slug(value: str, occupied: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:240] or "page"
    candidate, suffix = base, 2
    while candidate in occupied:
        candidate = f"{base[: 240 - len(str(suffix)) - 1]}-{suffix}"
        suffix += 1
    occupied.add(candidate)
    return candidate


def _build_view_file_card_html(filename: str, url: str) -> str:
    escaped_fn = html.escape(filename)
    escaped_url = html.escape(url)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    title_no_ext = filename.rsplit(".", 1)[0] if "." in filename else filename
    escaped_title = html.escape(title_no_ext)

    if ext in {"pptx", "ppt"}:
        bg_gradient = "from-rose-600 via-red-700 to-amber-700"
        badge_text = "Presentation"
        badge_bg = "bg-rose-950/40 text-rose-100"
        icon = "📊"
    elif ext in {"pdf"}:
        bg_gradient = "from-red-600 via-rose-800 to-slate-900"
        badge_text = "PDF Document"
        badge_bg = "bg-red-950/40 text-red-100"
        icon = "📕"
    elif ext in {"docx", "doc"}:
        bg_gradient = "from-blue-600 via-indigo-700 to-slate-900"
        badge_text = "Word Document"
        badge_bg = "bg-blue-950/40 text-blue-100"
        icon = "📝"
    elif ext in {"xlsx", "xls"}:
        bg_gradient = "from-emerald-600 via-teal-700 to-slate-900"
        badge_text = "Spreadsheet"
        badge_bg = "bg-emerald-950/40 text-emerald-100"
        icon = "📈"
    elif ext in {"png", "jpg", "jpeg", "gif", "webp", "svg"}:
        return (
            f'<div class="confluence-macro confluence-macro-view-file my-4 inline-block border border-border rounded-xl bg-surface shadow-2xs overflow-hidden max-w-sm m-1.5 align-top">'
            f'<img src="{escaped_url}" alt="{escaped_fn}" class="max-h-60 object-contain w-full bg-surface-sunken/30" />'
            f'<div class="p-2.5 flex items-center justify-between text-xs border-t border-border/40">'
            f'<span class="font-medium text-foreground truncate" title="{escaped_fn}">{escaped_fn}</span>'
            f'<a href="{escaped_url}" download="{escaped_fn}" class="text-primary hover:underline font-semibold ml-2 shrink-0">Download</a>'
            f'</div>'
            f'</div>'
        )
    else:
        bg_gradient = "from-slate-600 via-slate-700 to-slate-900"
        badge_text = "File"
        badge_bg = "bg-slate-950/40 text-slate-100"
        icon = "📄"

    return (
        f'<div class="confluence-macro confluence-macro-view-file my-3 inline-flex flex-col border border-border rounded-xl bg-surface shadow-xs hover:shadow-md hover:border-primary/50 transition-all overflow-hidden w-full sm:w-[260px] m-1.5 align-top">'
        f'<div class="h-32 bg-gradient-to-br {bg_gradient} p-3.5 flex flex-col justify-between text-white relative overflow-hidden group">'
        f'<div class="absolute -right-3 -bottom-3 opacity-15 text-5xl font-black select-none uppercase tracking-tighter">{ext}</div>'
        f'<span class="text-[10px] font-bold uppercase tracking-wider {badge_bg} border border-white/20 backdrop-blur-xs px-2 py-0.5 rounded-full w-max">{badge_text}</span>'
        f'<p class="font-bold text-xs leading-snug drop-shadow-xs line-clamp-3 my-auto">{escaped_title}</p>'
        f'</div>'
        f'<div class="p-2.5 flex items-center justify-between gap-2 bg-surface text-xs border-t border-border/40">'
        f'<div class="flex items-center gap-1.5 min-w-0">'
        f'<span class="text-sm shrink-0">{icon}</span>'
        f'<span class="text-[11px] font-medium text-foreground truncate" title="{escaped_fn}">{escaped_fn}</span>'
        f'</div>'
        f'<a href="{escaped_url}" download="{escaped_fn}" class="text-[11px] font-semibold text-primary hover:text-primary-hover hover:underline shrink-0">'
        f'Download'
        f'</a>'
        f'</div>'
        f'</div>'
    )


def _build_attachments_table_html(files: list[dict[str, str]]) -> str:
    if not files:
        return ""

    rows = []
    for f in files:
        fn = html.escape(f["filename"])
        url = html.escape(f["url"])
        ext = fn.rsplit(".", 1)[-1].lower() if "." in fn else ""
        icon = "📄"
        if ext in {"ppt", "pptx"}:
            icon = "📊"
        elif ext in {"doc", "docx"}:
            icon = "📝"
        elif ext in {"xls", "xlsx"}:
            icon = "📈"
        elif ext == "pdf":
            icon = "📕"
        elif ext in {"zip", "tar", "gz", "7z", "rar"}:
            icon = "📦"
        elif ext in {"png", "jpg", "jpeg", "gif", "webp", "svg"}:
            icon = "🖼️"

        rows.append(
            f'<tr>'
            f'<td class="px-4 py-2.5 font-medium text-foreground">'
            f'<a href="{url}" download="{fn}" class="text-primary hover:underline inline-flex items-center gap-2">'
            f'<span>{icon}</span> <span>{fn}</span>'
            f'</a>'
            f'</td>'
            f'<td class="px-4 py-2.5 text-right">'
            f'<a href="{url}" download="{fn}" class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">'
            f'Download'
            f'</a>'
            f'</td>'
            f'</tr>'
        )

    tbody = "".join(rows)
    return (
        f'<div class="confluence-macro confluence-macro-attachments border border-border rounded-lg bg-surface shadow-2xs my-4 overflow-hidden">'
        f'<div class="border-b border-border bg-surface-sunken/40 px-4 py-2 flex items-center justify-between">'
        f'<span class="text-xs font-semibold text-foreground flex items-center gap-1.5">'
        f'📎 Attached Files ({len(files)})'
        f'</span>'
        f'</div>'
        f'<div class="overflow-x-auto">'
        f'<table class="w-full text-xs">'
        f'<thead>'
        f'<tr class="bg-surface-sunken/60 text-muted-foreground border-b border-border text-left">'
        f'<th class="px-4 py-2 font-medium">File</th>'
        f'<th class="px-4 py-2 font-medium w-28 text-right">Action</th>'
        f'</tr>'
        f'</thead>'
        f'<tbody class="divide-y divide-border">{tbody}</tbody>'
        f'</table>'
        f'</div>'
        f'</div>'
    )


def _build_gallery_html(images: list[dict[str, str]]) -> str:
    if not images:
        return ""

    cards = []
    for img in images:
        fn = html.escape(img["filename"])
        url = html.escape(img["url"])
        cards.append(
            f'<div class="border border-border rounded-lg overflow-hidden bg-surface shadow-2xs group flex flex-col">'
            f'<a href="{url}" target="_blank" rel="noreferrer" class="block aspect-video bg-surface-sunken overflow-hidden flex items-center justify-center p-1">'
            f'<img src="{url}" alt="{fn}" class="object-contain w-full h-full group-hover:scale-105 transition-transform duration-200" />'
            f'</a>'
            f'<div class="p-2 border-t border-border bg-surface-sunken/30">'
            f'<p class="text-[11px] font-medium text-foreground truncate" title="{fn}">{fn}</p>'
            f'</div>'
            f'</div>'
        )

    grid = "".join(cards)
    return (
        f'<div class="confluence-macro confluence-macro-gallery grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 my-4">'
        f'{grid}'
        f'</div>'
    )


def _link_imported_attachments(
    content: str,
    source_page_id: str,
    urls: dict[tuple[str, str], str],
    title_to_page_id: dict[str, str],
) -> str:
    """Turn Confluence attachment/image macros and raw URLs into usable WikiHub HTML."""
    if not urls:
        return content
    soup = BeautifulSoup(content, "html.parser")

    # Collect all attachments belonging to this page
    this_page_files: list[dict[str, str]] = []
    this_page_images: list[dict[str, str]] = []
    this_page_docs: list[dict[str, str]] = []
    for (pid, fn), u in urls.items():
        if pid == source_page_id:
            item = {"filename": fn, "url": u}
            this_page_files.append(item)
            ext = fn.rsplit(".", 1)[-1].lower() if "." in fn else ""
            if ext in {"png", "jpg", "jpeg", "gif", "webp", "svg"}:
                this_page_images.append(item)
            else:
                this_page_docs.append(item)

    # 1. Resolve <ac:image> macros
    for macro in soup.find_all("ac:image"):
        attachment = macro.find("ri:attachment")
        filename = attachment.get("ri:filename") if attachment else None
        if not isinstance(filename, str):
            continue

        # Determine referenced page_id
        page_ref = macro.find("ri:page")
        ref_title = page_ref.get("ri:content-title") if page_ref else None
        target_page_id = (title_to_page_id.get(ref_title) if ref_title else None) or source_page_id

        url = urls.get((target_page_id, filename))
        if not url:
            url = urls.get((target_page_id, filename.replace("+", " ")))
        if not url:
            url = next(
                (
                    u
                    for (_pid, fn), u in urls.items()
                    if fn == filename or fn == filename.replace("+", " ")
                ),
                None,
            )

        if url:
            image = soup.new_tag("img", src=url, alt=filename)
            for attr in ("width", "height", "ac:width", "ac:height"):
                val = macro.get(attr)
                if val:
                    image[attr.replace("ac:", "")] = val
            macro.replace_with(image)

    # 2. Resolve <ac:link> macros
    for macro in soup.find_all("ac:link"):
        attachment = macro.find("ri:attachment")
        filename = attachment.get("ri:filename") if attachment else None
        if not isinstance(filename, str):
            continue

        page_ref = macro.find("ri:page")
        ref_title = page_ref.get("ri:content-title") if page_ref else None
        target_page_id = (title_to_page_id.get(ref_title) if ref_title else None) or source_page_id

        url = urls.get((target_page_id, filename))
        if not url:
            url = urls.get((target_page_id, filename.replace("+", " ")))
        if not url:
            url = next(
                (
                    u
                    for (_pid, fn), u in urls.items()
                    if fn == filename or fn == filename.replace("+", " ")
                ),
                None,
            )

        if url:
            link = soup.new_tag("a", href=url)
            link.string = macro.get_text(" ", strip=True) or filename
            macro.replace_with(link)

    # 3. Resolve <div data-macro="attachments"> or <ac:structured-macro ac:name="attachments">
    attachment_macros = soup.find_all(
        lambda tag: (
            tag.name == "div" and tag.get("data-macro") == "attachments"
        ) or (
            tag.name in {"ac:structured-macro", "structured-macro"}
            and (tag.get("ac:name") or tag.get("name") or "").lower() == "attachments"
        )
    )
    for m in attachment_macros:
        files_to_render = this_page_docs if this_page_docs else this_page_files
        tbl_html = _build_attachments_table_html(files_to_render)
        if tbl_html:
            m_soup = BeautifulSoup(tbl_html, "html.parser")
            m.replace_with(m_soup)
        else:
            m.decompose()

    # 4. Resolve <div data-macro="gallery"> or <ac:structured-macro ac:name="gallery">
    gallery_macros = soup.find_all(
        lambda tag: (
            tag.name == "div" and tag.get("data-macro") == "gallery"
        ) or (
            tag.name in {"ac:structured-macro", "structured-macro"}
            and (tag.get("ac:name") or tag.get("name") or "").lower() == "gallery"
        )
    )
    for m in gallery_macros:
        gal_html = _build_gallery_html(this_page_images)
        if gal_html:
            m_soup = BeautifulSoup(gal_html, "html.parser")
            m.replace_with(m_soup)
        else:
            m.decompose()

    # 5. Resolve <div data-macro="view-file"> or <ac:structured-macro ac:name="view-file">
    view_file_macros = soup.find_all(
        lambda tag: (
            tag.name == "div" and tag.get("data-macro") in {"view-file", "viewfile", "view-doc", "viewdoc"}
        ) or (
            tag.name in {"ac:structured-macro", "structured-macro"}
            and (tag.get("ac:name") or tag.get("name") or "").lower() in {"view-file", "viewfile", "view-doc", "viewdoc"}
        )
    )
    for m in view_file_macros:
        attachment = m.find(["ri:attachment", "attachment"])
        filename = attachment.get("ri:filename") or attachment.get("filename") if attachment else None
        if not filename:
            span_fn = m.find(lambda s: s.name == "span" and s.get("data-filename"))
            if span_fn:
                filename = span_fn.get("data-filename")
        if not filename:
            param = m.find(
                lambda p: p.name in {"ac:parameter", "parameter"}
                and p.get("ac:name") in {"name", "filename", "0"}
            )
            if param:
                filename = param.get_text().strip()

        if not isinstance(filename, str) or not filename:
            m.decompose()
            continue

        page_ref = m.find("ri:page")
        ref_title = page_ref.get("ri:content-title") if page_ref else None
        target_page_id = (title_to_page_id.get(ref_title) if ref_title else None) or source_page_id

        url = urls.get((target_page_id, filename))
        if not url:
            url = urls.get((target_page_id, filename.replace("+", " ")))
        if not url:
            url = next(
                (
                    u
                    for (_pid, fn), u in urls.items()
                    if fn == filename or fn == filename.replace("+", " ")
                ),
                None,
            )

        if not url:
            url = f"#attachment-{filename}"

        card_html = _build_view_file_card_html(filename, url)
        card_soup = BeautifulSoup(card_html, "html.parser")
        m.replace_with(card_soup)

    # If page has files and neither macro was explicitly present, check if we should render them
    if this_page_files and not attachment_macros and not gallery_macros:
        # Check if files were not already linked in the content
        unlinked_docs = [
            f for f in this_page_docs if f["url"] not in str(soup)
        ]
        unlinked_images = [
            img for img in this_page_images if img["url"] not in str(soup)
        ]
        if unlinked_docs:
            tbl_soup = BeautifulSoup(_build_attachments_table_html(unlinked_docs), "html.parser")
            soup.append(tbl_soup)
        if unlinked_images:
            gal_soup = BeautifulSoup(_build_gallery_html(unlinked_images), "html.parser")
            soup.append(gal_soup)

    result = str(soup)

    # 5. Replace raw attachment URLs with query parameters or without
    def replace_url(match: re.Match) -> str:
        pid = match.group(1)
        fn = urllib.parse.unquote_plus(match.group(2))
        url = urls.get((pid, fn))
        if not url:
            url = next((u for (p, f), u in urls.items() if f == fn), None)
        return url if url else match.group(0)

    result = re.sub(
        r"/download/attachments/(\d+)/([^?\"'\s>]+)(?:\?[^\"'\s>]*)?", replace_url, result
    )

    return result


def _normalize_confluence_html(content: str) -> str:
    """Convert Confluence XML-style macros, task lists, layouts, and parameters into standard WikiHub HTML elements."""
    if not content:
        return content

    # Quick check: if no confluence tags are present, return unchanged
    if (
        "<ac:" not in content
        and "<ri:" not in content
        and "<task-list" not in content
        and "<layout" not in content
    ):
        return content

    def _escape_cdata(match: re.Match) -> str:
        inner = match.group(1)
        return (
            inner.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

    content = re.sub(
        r"<!\[CDATA\[([\s\S]*?)\]\]\s*(?:>?|&gt;)?\s*",
        _escape_cdata,
        content,
        flags=re.IGNORECASE,
    )

    soup = BeautifulSoup(content, "html.parser")

    # 1. Normalize Task Lists: <ac:task-list> / <ac:task>
    for task_list in soup.find_all(["ac:task-list", "task-list"]):
        ul_tag = soup.new_tag(
            "ul",
            attrs={"class": "task-list space-y-1.5 my-3 pl-1", "data-type": "taskList"},
        )
        for task in task_list.find_all(["ac:task", "task"]):
            status_tag = task.find(["ac:task-status", "task-status"])
            status_text = status_tag.get_text().strip().lower() if status_tag else ""
            is_checked = status_text in {"complete", "completed", "checked", "true"}

            body_tag = task.find(["ac:task-body", "task-body"])
            body_html = "".join(str(c) for c in body_tag.contents) if body_tag else ""
            if not body_html:
                if status_tag:
                    status_tag.decompose()
                task_id_tag = task.find(["ac:task-id", "task-id"])
                if task_id_tag:
                    task_id_tag.decompose()
                body_html = task.get_text().strip()

            li_tag = soup.new_tag(
                "li",
                attrs={
                    "class": "task-list-item flex items-start gap-2 text-sm text-foreground my-1",
                    "data-type": "taskItem",
                    "data-checked": "true" if is_checked else "false",
                },
            )

            checkbox_tag = soup.new_tag(
                "input",
                attrs={
                    "type": "checkbox",
                    "class": "accent-primary size-4 mt-0.5 rounded border-border shrink-0 cursor-default",
                },
            )
            if is_checked:
                checkbox_tag["checked"] = "checked"
            checkbox_tag["disabled"] = "disabled"

            span_tag = soup.new_tag(
                "span",
                attrs={
                    "class": "task-body min-w-0"
                    + (" line-through text-muted-foreground" if is_checked else "")
                },
            )
            body_soup = BeautifulSoup(body_html, "html.parser")
            for item in list(body_soup.contents):
                span_tag.append(item)

            li_tag.append(checkbox_tag)
            li_tag.append(span_tag)
            ul_tag.append(li_tag)
        task_list.replace_with(ul_tag)

    # 2. Normalize Confluence Page Layout Grid: <ac:layout>, <ac:layout-section>, <ac:layout-cell>
    for layout in soup.find_all(["ac:layout", "layout"]):
        layout_div = soup.new_tag(
            "div", attrs={"class": "confluence-layout space-y-4 my-4"}
        )
        for section in layout.find_all(["ac:layout-section", "layout-section"]):
            stype = (section.get("ac:type") or section.get("type") or "single").lower()

            grid_class = "grid grid-cols-1 gap-4 my-4"
            if stype in {"two_equal", "two-equal"}:
                grid_class = "grid grid-cols-1 md:grid-cols-2 gap-4 my-4"
            elif stype in {"two_left_sidebar"}:
                grid_class = "grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4 my-4"
            elif stype in {"two_right_sidebar"}:
                grid_class = "grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4 my-4"
            elif stype in {"three_equal", "three-equal"}:
                grid_class = "grid grid-cols-1 md:grid-cols-3 gap-4 my-4"
            elif stype in {"three_with_sidebars"}:
                grid_class = "grid grid-cols-1 md:grid-cols-[1fr_2fr_1fr] gap-4 my-4"

            sec_div = soup.new_tag(
                "div",
                attrs={
                    "class": f"confluence-layout-section {grid_class}",
                    "data-layout-type": stype,
                },
            )
            for cell in section.find_all(["ac:layout-cell", "layout-cell"]):
                cell_div = soup.new_tag(
                    "div",
                    attrs={
                        "class": "confluence-layout-cell border border-border/40 p-4 rounded-lg bg-surface/50 shadow-2xs flex flex-col justify-start min-w-0"
                    },
                )
                for child in list(cell.contents):
                    cell_div.append(child)
                sec_div.append(cell_div)
            layout_div.append(sec_div)
        layout.replace_with(layout_div)

    # 3. Normalize Structured Macros: <ac:structured-macro>
    for macro in soup.find_all(["ac:structured-macro", "structured-macro"]):
        macro_name = (macro.get("ac:name") or macro.get("name") or "").lower()

        # Handle Code Macro
        if macro_name == "code":
            code_tag = macro.find(["ac:plain-text-body", "plain-text-body"])
            code_text = code_tag.get_text() if code_tag else macro.get_text().strip()
            if re.match(r"^\s*<!\[CDATA\[", code_text, re.IGNORECASE):
                code_text = re.sub(
                    r"^\s*<!\[CDATA\[", "", code_text, count=1, flags=re.IGNORECASE
                )
                code_text = re.sub(
                    r"\]\]\s*(?:>?|&gt;)\s*$",
                    "",
                    code_text,
                    count=1,
                    flags=re.IGNORECASE,
                )
            code_text = code_text.strip("\r\n")

            lang_param = macro.find("ac:parameter", attrs={"ac:name": "language"})
            language = lang_param.get_text().strip().lower() if lang_param else ""
            language = re.sub(r"[^a-z0-9_-]", "", language)

            pre_tag = soup.new_tag("pre")
            code_el = soup.new_tag("code")
            if language:
                code_el["class"] = f"language-{language}"
            code_el.string = code_text
            pre_tag.append(code_el)
            macro.replace_with(pre_tag)
            continue

        # Handle Callout Macros: info, warning, note, tip, panel, expand
        if macro_name in {"info", "warning", "note", "tip", "panel", "expand"}:
            body_tag = macro.find(["ac:rich-text-body", "rich-text-body"])
            body_html = (
                "".join(str(c) for c in body_tag.contents) if body_tag else ""
            )

            title_param = macro.find("ac:parameter", attrs={"ac:name": "title"})
            title_text = title_param.get_text().strip() if title_param else ""

            callout_type = "panel" if macro_name == "expand" else macro_name
            callout_div = soup.new_tag(
                "div",
                attrs={
                    "data-type": "callout",
                    "data-callout-type": callout_type,
                    "class": f"callout callout-{callout_type} my-4 p-4 rounded-lg border bg-surface shadow-2xs",
                },
            )
            if title_text:
                title_p = soup.new_tag(
                    "p", attrs={"class": "font-semibold mb-1 text-foreground"}
                )
                title_p.string = title_text
                callout_div.append(title_p)

            body_soup = BeautifulSoup(body_html, "html.parser")
            for item in list(body_soup.contents):
                callout_div.append(item)
            macro.replace_with(callout_div)
            continue

        # Handle Search / Livesearch Macro
        if macro_name in {"search", "livesearch"}:
            card_div = soup.new_tag(
                "div",
                attrs={
                    "class": "confluence-macro confluence-macro-search border border-border p-4 rounded-lg bg-surface shadow-2xs my-4 space-y-2"
                },
            )
            h4 = soup.new_tag(
                "h4", attrs={"class": "text-sm font-semibold text-foreground"}
            )
            h4.string = "Search this documentation"
            card_div.append(h4)

            form = soup.new_tag(
                "form",
                attrs={
                    "action": "/search",
                    "method": "get",
                    "class": "flex items-center gap-2",
                },
            )
            inp = soup.new_tag(
                "input",
                attrs={
                    "type": "text",
                    "name": "q",
                    "placeholder": "Search pages in this space...",
                    "class": "flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary",
                },
            )
            btn = soup.new_tag(
                "button",
                attrs={
                    "type": "submit",
                    "class": "px-3 py-1.5 text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md cursor-pointer",
                },
            )
            btn.string = "Search"
            form.append(inp)
            form.append(btn)
            card_div.append(form)
            macro.replace_with(card_div)
            continue

        # Handle Popular Topics / Labels Macro
        if macro_name in {"popular-topics", "labels"}:
            card_div = soup.new_tag(
                "div",
                attrs={
                    "class": "confluence-macro confluence-macro-labels border border-border p-4 rounded-lg bg-surface shadow-2xs my-4 space-y-2"
                },
            )
            h4 = soup.new_tag(
                "h4", attrs={"class": "text-sm font-semibold text-foreground"}
            )
            h4.string = "Popular Topics"
            p = soup.new_tag("p", attrs={"class": "text-xs text-muted-foreground"})
            p.string = "No labels match these criteria."
            card_div.append(h4)
            card_div.append(p)
            macro.replace_with(card_div)
            continue

        # Handle Featured Pages / Content-by-label Macro
        if macro_name in {"content-by-label", "featured-pages"}:
            card_div = soup.new_tag(
                "div",
                attrs={
                    "class": "confluence-macro confluence-macro-featured border border-border p-4 rounded-lg bg-surface shadow-2xs my-4 space-y-2"
                },
            )
            h4 = soup.new_tag(
                "h4", attrs={"class": "text-sm font-semibold text-foreground"}
            )
            h4.string = "Featured Pages"
            p = soup.new_tag("p", attrs={"class": "text-xs text-muted-foreground"})
            p.string = "There is no content with the specified labels."
            card_div.append(h4)
            card_div.append(p)
            macro.replace_with(card_div)
            continue

        # Handle Recently Updated Pages Macro
        if macro_name in {"recently-updated", "recent-updates"}:
            card_div = soup.new_tag(
                "div",
                attrs={
                    "class": "confluence-macro confluence-macro-recent border border-border p-4 rounded-lg bg-surface shadow-2xs my-4 space-y-2"
                },
            )
            h4 = soup.new_tag(
                "h4", attrs={"class": "text-sm font-semibold text-foreground"}
            )
            h4.string = "Recently Updated Pages"
            p = soup.new_tag("p", attrs={"class": "text-xs text-muted-foreground"})
            p.string = "Browse recent updates in the space page tree."
            card_div.append(h4)
            card_div.append(p)
            macro.replace_with(card_div)
            continue

        # Handle Status Macro
        if macro_name == "status":
            title_param = macro.find("ac:parameter", attrs={"ac:name": "title"})
            status_title = (
                title_param.get_text().strip()
                if title_param
                else macro.get_text().strip()
            )
            badge_span = soup.new_tag(
                "span",
                attrs={
                    "class": "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold bg-primary-subtle text-primary border border-primary/20 my-1"
                },
            )
            badge_span.string = status_title
            macro.replace_with(badge_span)
            continue

        # Handle Attachments Macro
        if macro_name == "attachments":
            card_div = soup.new_tag(
                "div",
                attrs={
                    "class": "confluence-macro confluence-macro-attachments",
                    "data-macro": "attachments",
                },
            )
            macro.replace_with(card_div)
            continue

        # Handle Gallery Macro
        if macro_name == "gallery":
            card_div = soup.new_tag(
                "div",
                attrs={
                    "class": "confluence-macro confluence-macro-gallery",
                    "data-macro": "gallery",
                },
            )
            macro.replace_with(card_div)
            continue

        # Handle View File Macro
        if macro_name in {"view-file", "viewfile", "view-doc", "viewdoc"}:
            card_div = soup.new_tag(
                "div",
                attrs={
                    "class": "confluence-macro confluence-macro-view-file",
                    "data-macro": "view-file",
                },
            )
            attachment = macro.find(["ri:attachment", "attachment"])
            if attachment:
                card_div.append(attachment)
            else:
                param = macro.find(
                    lambda p: (
                        p.name in {"ac:parameter", "parameter"}
                        and p.get("ac:name") in {"name", "filename", "0"}
                    )
                )
                if param:
                    filename_text = param.get_text().strip()
                    if filename_text:
                        span_file = soup.new_tag(
                            "span", attrs={"data-filename": filename_text}
                        )
                        card_div.append(span_file)

            macro.replace_with(card_div)
            continue

        # Generic Macro Fallback: extract rich-text-body or plain-text-body if present, otherwise strip parameter tags
        body_tag = macro.find(
            [
                "ac:rich-text-body",
                "rich-text-body",
                "ac:plain-text-body",
                "plain-text-body",
            ]
        )
        if body_tag:
            body_html = "".join(str(c) for c in body_tag.contents)
            body_soup = BeautifulSoup(body_html, "html.parser")
            macro.replace_with(body_soup)
        else:
            for param in macro.find_all(["ac:parameter", "parameter"]):
                param.decompose()
            text = macro.get_text().strip()
            if text:
                span_tag = soup.new_tag(
                    "span", attrs={"class": "confluence-macro-fallback"}
                )
                span_tag.string = text
                macro.replace_with(span_tag)
            else:
                macro.decompose()

    # 4. Decompose any remaining unparsed Confluence metadata tags: <ac:parameter>, <ac:placeholder>
    for param in soup.find_all(
        ["ac:parameter", "parameter", "ac:placeholder", "placeholder"]
    ):
        param.decompose()

    return str(soup)


def _normalize_confluence_code_macros(content: str) -> str:
    """Alias for _normalize_confluence_html for backward compatibility."""
    return _normalize_confluence_html(content)


class SeekableS3File(io.BufferedIOBase):
    """Seekable read-only file-like wrapper around S3 object using Byte Range requests.

    Allows zipfile.ZipFile to inspect and read specific files (like entities.xml)
    from multi-gigabyte S3 archives in seconds without downloading the whole archive.
    """

    def __init__(self, client: Any, bucket: str, key: str, size: int) -> None:
        self.client = client
        self.bucket = bucket
        self.key = key
        self._size = size
        self._pos = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            self._pos = offset
        elif whence == io.SEEK_CUR:
            self._pos += offset
        elif whence == io.SEEK_END:
            self._pos = self._size + offset
        self._pos = max(0, min(self._pos, self._size))
        return self._pos

    def read(self, size: int = -1) -> bytes:
        if self._pos >= self._size:
            return b""
        if size is None or size < 0:
            size = self._size - self._pos
        end_pos = min(self._pos + size - 1, self._size - 1)
        if end_pos < self._pos:
            return b""
        response = self.client.get_object(
            Bucket=self.bucket,
            Key=self.key,
            Range=f"bytes={self._pos}-{end_pos}",
        )
        data = response["Body"].read()
        self._pos += len(data)
        return data


class ConfluenceImportService:
    # S3 multipart uploads require every non-final part to be at least 5 MiB.
    # Eight MiB keeps retry costs reasonable without creating too many requests.
    upload_part_size_bytes = 8 * 1024 * 1024

    def __init__(self, session: AsyncSession, storage: ObjectStorage) -> None:
        self.session, self.storage = session, storage
        self._user_cache: dict[str, uuid.UUID] = {}

    def _scan_archive_sync(self, archive: ImportArchive) -> list[ConfluenceSpace]:
        s3_client = getattr(self.storage, "_client", None)
        bucket = getattr(self.storage, "bucket", None)

        if s3_client is not None and bucket is not None:
            try:
                s3_file = SeekableS3File(s3_client, bucket, archive.object_key, archive.size_bytes)
                return scan_archive(s3_file)
            except Exception as stream_err:
                logger.warning(
                    "Streaming range-scan failed for %s, falling back to local file download: %s",
                    archive.object_key,
                    stream_err,
                )

        with tempfile.TemporaryDirectory(prefix="wikihub-confluence-scan-") as directory:
            path = Path(directory) / "archive.zip"
            if s3_client is not None and bucket is not None:
                s3_client.download_file(bucket, archive.object_key, str(path))
            else:
                import asyncio
                asyncio.run(self.storage.download_to_file(archive.object_key, str(path)))
            return scan_archive(path)

    async def scan(self, archive: ImportArchive) -> ImportArchive:
        existing = set((await self.session.execute(select(Space.key))).scalars())
        if archive.status == "scanned" and archive.spaces:
            archive.spaces = [
                {
                    **item,
                    "conflict": item.get("key") in existing,
                }
                for item in archive.spaces
            ]
            archive.error = None
            await self.session.flush()
            return archive
        if not await self.storage.exists(archive.object_key):
            raise BadRequestError("The archive upload has not completed yet.")

        try:
            spaces = await anyio.to_thread.run_sync(self._scan_archive_sync, archive)
        except BadRequestError:
            raise
        except Exception as scan_error:
            logger.error(
                "Failed to scan Confluence archive %s: %s",
                archive.id,
                scan_error,
                exc_info=True,
            )
            archive.error = str(scan_error)
            await self.session.flush()
            raise BadRequestError(f"Could not scan Confluence archive: {scan_error}") from scan_error

        archive.spaces = [
            {
                "key": item.key,
                "name": item.name,
                "page_count": len(item.pages),
                "attachment_count": item.attachment_count,
                "conflict": item.key in existing,
            }
            for item in spaces
        ]
        archive.status = "scanned"
        archive.error = None
        await self.session.flush()
        return archive

    async def _resolve_or_create_user(self, username: str) -> uuid.UUID | None:
        normalized_username = username.strip()
        if _is_invalid_import_username(normalized_username):
            return None
        username_lower = normalized_username.lower()
        if username_lower in self._user_cache:
            return self._user_cache[username_lower]

        from app.models.user import User

        result = await self.session.execute(
            select(User).where(func.lower(User.username) == username_lower)
        )
        user = result.scalars().first()
        if user:
            self._user_cache[username_lower] = user.id
            return user.id

        new_user = User(
            username=normalized_username,
            email=f"{normalized_username}@imported.confluence",
            full_name=normalized_username,
            password_hash=None,
            is_active=True,
            is_superuser=False,
            is_protected=False,
        )
        self.session.add(new_user)
        await self.session.flush()
        self._user_cache[username_lower] = new_user.id
        return new_user.id

    async def find_reusable_archive(self, *, sha256: str, size_bytes: int) -> ImportArchive | None:
        archives = (
            await self.session.execute(
                select(ImportArchive)
                .where(
                    ImportArchive.sha256 == sha256,
                    ImportArchive.size_bytes == size_bytes,
                    ImportArchive.status.in_(["uploaded", "scanned"]),
                    ImportArchive.multipart_upload_id.is_(None),
                )
                .order_by(ImportArchive.updated_at.desc(), ImportArchive.created_at.desc())
                .limit(5)
            )
        ).scalars()
        for archive in archives:
            if await self.storage.exists(archive.object_key):
                return archive
        return None

    async def start_upload(
        self, *, filename: str, size_bytes: int, actor_id: uuid.UUID, sha256: str | None = None
    ) -> ImportArchive:
        if not filename.lower().endswith(".zip"):
            raise BadRequestError("Choose a .zip archive exported by Confluence.")
        from app.services.site_settings import SiteSettingsService

        limit = (
            await SiteSettingsService(self.session).get_effective()
        ).max_backup_import_size_bytes
        if size_bytes > limit:
            raise PayloadTooLargeError(
                f"Archive exceeds the configured {limit // (1024 * 1024)} MB limit."
            )
        if sha256:
            reusable = await self.find_reusable_archive(sha256=sha256, size_bytes=size_bytes)
            if reusable is not None:
                return reusable
        archive = ImportArchive(
            object_key=f"imports/confluence/{uuid.uuid4()}/{filename}",
            filename=filename,
            size_bytes=size_bytes,
            sha256=sha256,
            created_by_id=actor_id,
        )
        self.session.add(archive)
        await self.session.flush()
        archive.multipart_upload_id = await self.storage.start_multipart_upload(
            archive.object_key, content_type="application/zip"
        )
        await self.session.flush()
        return archive

    async def get_archive(self, archive_id: uuid.UUID) -> ImportArchive:
        archive = await self.session.get(ImportArchive, archive_id)
        if archive is None:
            raise NotFoundError("Import archive was not found.")
        if archive.spaces:
            existing = set((await self.session.execute(select(Space.key))).scalars())
            archive.spaces = [
                {
                    **item,
                    "conflict": item.get("key") in existing,
                }
                for item in archive.spaces
            ]
        return archive

    async def uploaded_part_numbers(self, archive: ImportArchive) -> list[int]:
        if not archive.multipart_upload_id:
            return []
        return [
            number
            for number, _etag in await self.storage.list_multipart_parts(
                archive.object_key, archive.multipart_upload_id
            )
        ]

    async def upload_part_urls(
        self, archive: ImportArchive, part_numbers: list[int]
    ) -> dict[int, str]:
        if archive.status != "uploading" or not archive.multipart_upload_id:
            raise ConflictError("This archive is not accepting upload parts.")
        return {
            part_number: await self.storage.presigned_upload_part_url(
                archive.object_key, archive.multipart_upload_id, part_number, expires_in=3600
            )
            for part_number in part_numbers
        }

    async def complete_upload(self, archive: ImportArchive) -> ImportArchive:
        if archive.status != "uploading" or not archive.multipart_upload_id:
            raise ConflictError("This archive upload has already completed.")
        parts = await self.storage.list_multipart_parts(
            archive.object_key, archive.multipart_upload_id
        )
        expected_parts = (
            archive.size_bytes + self.upload_part_size_bytes - 1
        ) // self.upload_part_size_bytes
        actual_parts = {number for number, _etag in parts}
        if actual_parts != set(range(1, expected_parts + 1)):
            raise BadRequestError("The archive upload is incomplete.")
        await self.storage.complete_multipart_upload(
            archive.object_key, archive.multipart_upload_id, parts
        )
        archive.multipart_upload_id = None
        archive.status = "uploaded"
        await self.session.flush()
        return archive

    async def abort_upload(self, archive: ImportArchive) -> None:
        if archive.multipart_upload_id:
            with suppress(NotFoundError):
                await self.storage.abort_multipart_upload(
                    archive.object_key, archive.multipart_upload_id
                )
            archive.multipart_upload_id = None
            archive.status = "cancelled"
            await self.session.flush()

    async def create_job(
        self,
        archive: ImportArchive,
        *,
        import_all: bool,
        space_keys: list[str],
        overwrite_existing: bool,
        actor_id: uuid.UUID,
    ) -> ImportJob:
        if archive.status != "scanned":
            raise ConflictError("Wait until the archive scan finishes before starting import.")
        available = {item["key"] for item in archive.spaces}
        selected = sorted(set(space_keys))
        if not import_all and not selected:
            raise BadRequestError("Select at least one Space or choose Import all spaces.")
        if set(selected) - available:
            raise BadRequestError("One or more selected Space keys are not in this archive.")
        selected_keys = available if import_all else set(selected)
        selected_spaces = [item for item in archive.spaces if item["key"] in selected_keys]
        job = ImportJob(
            archive_id=archive.id,
            created_by_id=actor_id,
            import_all=import_all,
            space_keys=[] if import_all else selected,
            overwrite_existing=overwrite_existing,
            counters={
                "spaces_total": len(selected_spaces),
                "spaces_completed": 0,
                "pages_total": sum(int(item.get("page_count", 0)) for item in selected_spaces),
                "pages_processed": 0,
                "attachments_processed": 0,
                "downloaded_bytes": 0,
                "download_total_bytes": archive.size_bytes,
                "download_percent": 0,
            },
        )
        self.session.add(job)
        await self.session.flush()
        return job


async def log(
    session: AsyncSession,
    job: ImportJob,
    level: str,
    phase: str,
    message: str,
    *,
    entity_type: str | None = None,
    entity_label: str | None = None,
) -> ImportLog:
    entry = ImportLog(
        job_id=job.id,
        level=level,
        phase=phase,
        message=message,
        entity_type=entity_type,
        entity_label=entity_label,
    )
    session.add(entry)
    return entry


async def run_import(session: AsyncSession, storage: ObjectStorage, job_id: uuid.UUID) -> None:
    service = ConfluenceImportService(session, storage)
    job = await session.get(ImportJob, job_id)
    if job is None or job.status not in {"queued", "retrying"}:
        return
    archive = await session.get(ImportArchive, job.archive_id)
    if archive is None:
        return
    assert job is not None
    assert archive is not None
    current_job: ImportJob = job
    current_archive: ImportArchive = archive
    job.status, job.phase = "running", "downloading"
    download_log = await log(
        session, job, "info", "downloading", "Downloading archive to worker scratch space: 0%."
    )
    await session.commit()
    try:
        with tempfile.TemporaryDirectory(prefix="wikihub-confluence-import-") as directory:
            path = Path(directory) / "archive.zip"
            last_logged_tenth = 0

            async def record_download_progress(downloaded_bytes: int) -> None:
                nonlocal last_logged_tenth
                await session.refresh(current_job)
                if current_job.cancel_requested:
                    raise ImportCancelled("Import cancelled by administrator.")
                percent = min(100, int(downloaded_bytes * 100 / max(1, current_archive.size_bytes)))
                if percent == current_job.counters.get("download_percent", 0):
                    return
                current_job.counters = {
                    **current_job.counters,
                    "downloaded_bytes": min(downloaded_bytes, current_archive.size_bytes),
                    "download_total_bytes": current_archive.size_bytes,
                    "download_percent": percent,
                }
                if percent // 10 > last_logged_tenth:
                    last_logged_tenth = percent // 10
                    download_log.message = (
                        f"Downloading archive to worker scratch space: {percent}%."
                    )
                await session.commit()

            await storage.download_to_file(
                archive.object_key,
                str(path),
                on_progress=record_download_progress,
            )
            job.phase = "scanning"
            job.counters = {
                **job.counters,
                "downloaded_bytes": archive.size_bytes,
                "download_total_bytes": archive.size_bytes,
                "download_percent": 100,
            }
            await log(
                session, job, "info", "scanning", "Archive downloaded. Reading its space structure."
            )
            await session.commit()
            scanned = await anyio.to_thread.run_sync(scan_archive, path)
            selected = {space.key for space in scanned} if job.import_all else set(job.space_keys)
            job.phase = "importing"
            await log(
                session, job, "info", "importing", "Archive ready. Importing selected spaces."
            )
            await session.commit()
            imported_pages: dict[str, WikiPage] = {}
            source_pages_by_id: dict[str, ConfluencePage] = {}

            def restore_timestamps() -> None:
                for source_id, target_page in imported_pages.items():
                    src_page = source_pages_by_id.get(source_id)
                    if src_page:
                        if src_page.created_at:
                            target_page.created_at = src_page.created_at
                        if src_page.updated_at:
                            target_page.updated_at = src_page.updated_at
                        elif src_page.created_at:
                            target_page.updated_at = src_page.created_at

            # 1. Resolve and create all imported Groups and Group Memberships
            group_by_name: dict[str, Group] = {}
            added_group_members: set[tuple[uuid.UUID, uuid.UUID]] = set()
            imported_groups = getattr(scanned, "groups", [])

            # Only import groups that have members or are referenced in space/page permissions
            active_group_names: set[str] = set()
            for group_data in imported_groups:
                if group_data.members:
                    active_group_names.add(group_data.name.strip().lower())

            for source_space in scanned:
                if source_space.permissions:
                    for perm in source_space.permissions:
                        if perm.group_name:
                            active_group_names.add(perm.group_name.strip().lower())
                if source_space.restrictions:
                    for restr in source_space.restrictions:
                        if restr.group_name:
                            active_group_names.add(restr.group_name.strip().lower())

            if imported_groups:
                for group_data in imported_groups:
                    if not group_data.name:
                        continue
                    gname = group_data.name.strip()
                    if not gname or _is_invalid_import_username(gname):
                        continue
                    gname_lower = gname.lower()
                    if gname_lower not in active_group_names:
                        continue
                    existing_group = (
                        await session.execute(
                            select(Group).where(func.lower(Group.name) == gname_lower)
                        )
                    ).scalar_one_or_none()

                    if existing_group:
                        group_by_name[gname_lower] = existing_group
                    else:
                        new_group = Group(
                            name=gname,
                            description=f"Imported from Confluence ({gname})",
                            owner_id=job.created_by_id,
                            is_active=True,
                        )
                        session.add(new_group)
                        await session.flush()
                        group_by_name[gname_lower] = new_group

                    grp = group_by_name[gname_lower]
                    for member_username in group_data.members:
                        uid = await service._resolve_or_create_user(member_username)
                        if uid:
                            gm_key = (grp.id, uid)
                            if gm_key not in added_group_members:
                                added_group_members.add(gm_key)
                                existing_gm = (
                                    await session.execute(
                                        select(GroupMember).where(
                                            GroupMember.group_id == grp.id,
                                            GroupMember.user_id == uid,
                                        )
                                    )
                                ).scalar_one_or_none()
                                if not existing_gm:
                                    session.add(GroupMember(group_id=grp.id, user_id=uid))
                await session.flush()

            for source_space in scanned:
                if source_space.key not in selected:
                    continue
                await session.refresh(job)
                if job.cancel_requested:
                    job.status, job.phase = "cancelled", "cancelled"
                    await log(
                        session, job, "warning", "cancelled", "Import cancelled by administrator."
                    )
                    await session.commit()
                    return
                existing = (
                    await session.execute(select(Space).where(Space.key == source_space.key))
                ).scalar_one_or_none()
                if existing:
                    if job.overwrite_existing:
                        await session.delete(existing)
                        await session.flush()
                        await log(
                            session,
                            job,
                            "warning",
                            "spaces",
                            "Existing space was replaced with the archive version.",
                            entity_type="space",
                            entity_label=source_space.key,
                        )
                    else:
                        job.counters = {
                            **job.counters,
                            "spaces_completed": job.counters.get("spaces_completed", 0) + 1,
                        }
                        await log(
                            session,
                            job,
                            "warning",
                            "spaces",
                            "Skipped: Space key already exists.",
                            entity_type="space",
                            entity_label=source_space.key,
                        )
                        await session.commit()
                        continue
                # Determine space visibility & space member roles from Confluence permissions
                is_restricted = False
                user_roles: dict[str, SpaceRole] = {}

                if source_space.permissions:
                    public_view = False
                    for perm in source_space.permissions:
                        if perm.perm_type in {"VIEWSPACE", "SETSPACEPERMISSIONS", "SPACEADMIN", "ADMINISTER"}:
                            grp_name = (perm.group_name or "").lower()
                            if grp_name in {"confluence-users", "confluence-administrators", "users", "anonymous", ""}:
                                public_view = True

                        if perm.user_name:
                            username_clean = perm.user_name.strip().lower()
                            if _is_invalid_import_username(username_clean):
                                continue

                            if perm.perm_type in {"SETSPACEPERMISSIONS", "ADMINISTERSPACE", "SPACEADMIN", "ADMINISTER"}:
                                user_roles[username_clean] = SpaceRole.admin
                            elif perm.perm_type in {"EDITSPACE", "CREATEPAGE", "REMOVEPAGE", "EDITBLOG"}:
                                if user_roles.get(username_clean) != SpaceRole.admin:
                                    user_roles[username_clean] = SpaceRole.editor
                            elif perm.perm_type == "VIEWSPACE":
                                if username_clean not in user_roles:
                                    user_roles[username_clean] = SpaceRole.viewer

                    if not public_view and (user_roles or any(p.group_name for p in source_space.permissions)):
                        is_restricted = True

                visibility = SpaceVisibility.restricted if is_restricted else SpaceVisibility.open

                space = Space(
                    key=source_space.key,
                    name=source_space.name,
                    created_by_id=job.created_by_id,
                    visibility=visibility,
                )
                session.add(space)
                await session.flush()
                session.add(
                    SpaceMember(space_id=space.id, user_id=job.created_by_id, role=SpaceRole.admin)
                )
                added_user_ids = {job.created_by_id}

                # Grant space membership to users resolved from Confluence permissions
                for uname, role in user_roles.items():
                    uid = await service._resolve_or_create_user(uname)
                    if uid and uid not in added_user_ids:
                        session.add(SpaceMember(space_id=space.id, user_id=uid, role=role))
                        added_user_ids.add(uid)

                # Grant SpaceGroupPermissions for groups referenced in space permissions
                added_space_group_perms: set[tuple[uuid.UUID, uuid.UUID, Permission]] = set()
                for perm in source_space.permissions:
                    if perm.group_name:
                        g_clean = perm.group_name.strip().lower()
                        grp = group_by_name.get(g_clean)
                        if grp:
                            p_enum = (
                                Permission.admin
                                if perm.perm_type
                                in {
                                    "SETSPACEPERMISSIONS",
                                    "ADMINISTERSPACE",
                                    "SPACEADMIN",
                                    "ADMINISTER",
                                }
                                else Permission.add
                                if perm.perm_type
                                in {"EDITSPACE", "CREATEPAGE", "REMOVEPAGE", "EDITBLOG"}
                                else Permission.view
                            )
                            sgp_key = (space.id, grp.id, p_enum)
                            if sgp_key not in added_space_group_perms:
                                added_space_group_perms.add(sgp_key)
                                existing_sgp = (
                                    await session.execute(
                                        select(SpaceGroupPermission).where(
                                            SpaceGroupPermission.space_id == space.id,
                                            SpaceGroupPermission.group_id == grp.id,
                                            SpaceGroupPermission.permission == p_enum,
                                        )
                                    )
                                ).scalar_one_or_none()
                                if not existing_sgp:
                                    session.add(
                                        SpaceGroupPermission(
                                            space_id=space.id,
                                            group_id=grp.id,
                                            permission=p_enum,
                                        )
                                    )

                pages: dict[str, WikiPage] = {}
                occupied: set[str] = set()
                for source_page in source_space.pages:
                    creator_is_invalid = bool(
                        source_page.creator and _is_invalid_import_username(source_page.creator)
                    )
                    modifier_is_invalid = bool(
                        source_page.last_modifier
                        and _is_invalid_import_username(source_page.last_modifier)
                    ) or (not source_page.last_modifier and creator_is_invalid)
                    creator_id = (
                        await service._resolve_or_create_user(source_page.creator)
                        if source_page.creator
                        else job.created_by_id
                    )
                    last_modifier_id = (
                        await service._resolve_or_create_user(source_page.last_modifier)
                        if source_page.last_modifier
                        else creator_id
                    )
                    page = WikiPage(
                        space_id=space.id,
                        title=source_page.title,
                        slug=_slug(source_page.title, occupied),
                        created_by_id=creator_id,
                        updated_by_id=last_modifier_id,
                        created_by_label=INVALID_IMPORT_USERNAME if creator_is_invalid else None,
                        updated_by_label=INVALID_IMPORT_USERNAME if modifier_is_invalid else None,
                        content_format="html",
                    )
                    session.add(page)
                    pages[source_page.source_id] = page
                    imported_pages[source_page.source_id] = page
                    source_pages_by_id[source_page.source_id] = source_page
                await session.flush()

                # Apply Page Restrictions from Confluence
                added_page_user_restrictions: set[
                    tuple[uuid.UUID, uuid.UUID, PageRestrictionPermission]
                ] = set()
                added_page_group_restrictions: set[
                    tuple[uuid.UUID, uuid.UUID, PageRestrictionPermission]
                ] = set()
                for restr in source_space.restrictions:
                    target_page = pages.get(restr.page_id)
                    if not target_page:
                        continue
                    perm_enum = (
                        PageRestrictionPermission.view
                        if restr.restriction_type == "view"
                        else PageRestrictionPermission.edit
                    )
                    if restr.user_name:
                        uid = await service._resolve_or_create_user(restr.user_name)
                        if uid:
                            pur_key = (target_page.id, uid, perm_enum)
                            if pur_key not in added_page_user_restrictions:
                                added_page_user_restrictions.add(pur_key)
                                existing_pur = (
                                    await session.execute(
                                        select(PageUserRestriction).where(
                                            PageUserRestriction.page_id == target_page.id,
                                            PageUserRestriction.user_id == uid,
                                            PageUserRestriction.permission == perm_enum,
                                        )
                                    )
                                ).scalar_one_or_none()
                                if not existing_pur:
                                    session.add(
                                        PageUserRestriction(
                                            page_id=target_page.id,
                                            user_id=uid,
                                            permission=perm_enum,
                                        )
                                    )

                    if restr.group_name:
                        grp = group_by_name.get(restr.group_name.strip().lower())
                        if grp:
                            pgr_key = (target_page.id, grp.id, perm_enum)
                            if pgr_key not in added_page_group_restrictions:
                                added_page_group_restrictions.add(pgr_key)
                                existing_pgr = (
                                    await session.execute(
                                        select(PageGroupRestriction).where(
                                            PageGroupRestriction.page_id == target_page.id,
                                            PageGroupRestriction.group_id == grp.id,
                                            PageGroupRestriction.permission == perm_enum,
                                        )
                                    )
                                ).scalar_one_or_none()
                                if not existing_pgr:
                                    session.add(
                                        PageGroupRestriction(
                                            page_id=target_page.id,
                                            group_id=grp.id,
                                            permission=perm_enum,
                                        )
                                    )

                # Confluence exports can contain several top-level pages. In
                # WikiHub every imported space has one stable home page so the
                # page tree has a single root. Prefer an exported page named
                # after the space; otherwise create a lightweight home page.
                root_source_pages = [
                    source_page for source_page in source_space.pages if not source_page.parent_id
                ]
                home_source = next(
                    (
                        source_page
                        for source_page in root_source_pages
                        if source_page.title.casefold()
                        in {source_space.key.casefold(), source_space.name.casefold()}
                    ),
                    None,
                )
                if home_source:
                    home_page = pages[home_source.source_id]
                else:
                    home_page = WikiPage(
                        space_id=space.id,
                        title=source_space.key,
                        slug=_slug(source_space.key, occupied),
                        created_by_id=job.created_by_id,
                        updated_by_id=job.created_by_id,
                        content_format="html",
                    )
                    session.add(home_page)
                    await session.flush()

                for source_page in source_space.pages:
                    parent = pages.get(source_page.parent_id or "")
                    if parent:
                        pages[source_page.source_id].parent_id = parent.id
                    # The home page is a navigation destination, not a
                    # container for imported content. Top-level Confluence
                    # pages stay at space level; only their own descendants
                    # retain the imported parent hierarchy.
                    elif pages[source_page.source_id].id != home_page.id:
                        pages[source_page.source_id].parent_id = None
                    imported_page = pages[source_page.source_id]
                    if source_page.created_at:
                        imported_page.created_at = source_page.created_at
                    if source_page.updated_at:
                        imported_page.updated_at = source_page.updated_at
                    elif source_page.created_at:
                        imported_page.updated_at = source_page.created_at
                await session.flush()
                count = len(pages)
                job.counters = {
                    **job.counters,
                    "spaces_completed": job.counters.get("spaces_completed", 0) + 1,
                    "pages_processed": job.counters.get("pages_processed", 0) + count,
                }
                await log(
                    session,
                    job,
                    "info",
                    "spaces",
                    f"Created {count} pages for space {space.key}.",
                    entity_type="space",
                    entity_label=space.key,
                )
                restore_timestamps()
                await session.commit()

            # Stream all page bodies in a single pass across the entire archive
            if imported_pages:
                for page_source_id, html_content in await anyio.to_thread.run_sync(
                    lambda: list(iter_page_bodies(path))
                ):
                    body_page: WikiPage | None = imported_pages.get(page_source_id)
                    if body_page:
                        body_page.content = _normalize_confluence_html(html_content)
                restore_timestamps()
                await session.commit()

            # Attachments Phase
            job.phase = "attachments"
            await log(
                session,
                job,
                "info",
                "attachments",
                "Reading attachments from archive...",
            )
            await session.commit()

            attachments_imported = 0
            attachment_urls: dict[tuple[str, str], str] = {}
            attachment_sources = await anyio.to_thread.run_sync(
                lambda: list(iter_attachments(path))
            )
            total_attachments = len(attachment_sources)
            job.counters = {
                **job.counters,
                "attachments_processed": 0,
                "attachments_total": total_attachments,
            }
            await session.commit()

            with zipfile.ZipFile(path) as source_archive:
                for idx, (source_attachment, archive_member) in enumerate(attachment_sources, 1):
                    target_page = imported_pages.get(source_attachment.page_id)
                    if target_page is None:
                        continue
                    try:
                        size_bytes = source_archive.getinfo(archive_member).file_size
                    except (KeyError, Exception):
                        size_bytes = 0
                    attachment = PageAttachment(
                        page_id=target_page.id,
                        filename=source_attachment.filename[:255],
                        content_type=source_attachment.content_type[:255],
                        object_key="",
                        size_bytes=size_bytes,
                    )
                    session.add(attachment)
                    await session.flush()
                    attachment.object_key = (
                        f"attachments/{target_page.id}/{attachment.id}/{source_attachment.filename}"
                    )
                    with source_archive.open(archive_member) as binary:
                        await storage.put(
                            attachment.object_key,
                            binary,
                            content_type=attachment.content_type,
                            metadata={"source": "confluence-import"},
                        )
                    attachment_urls[(source_attachment.page_id, source_attachment.filename)] = (
                        f"/api/v1/attachments/{attachment.id}/content"
                    )
                    attachments_imported += 1
                    if idx % 25 == 0 or idx == total_attachments:
                        job.counters = {
                            **job.counters,
                            "attachments_processed": attachments_imported,
                            "attachments_total": total_attachments,
                        }
                        await session.commit()

            if attachment_urls:
                title_to_page_id = {page.title: pid for pid, page in imported_pages.items()}
                for source_page_id, target_page in imported_pages.items():
                    target_page.content = _link_imported_attachments(
                        target_page.content, source_page_id, attachment_urls, title_to_page_id
                    )
                restore_timestamps()
            job.counters = {
                **job.counters,
                "attachments_processed": attachments_imported,
                "attachments_total": total_attachments,
            }
            await log(
                session,
                job,
                "info",
                "attachments",
                f"Imported {attachments_imported} attachments and linked them to their pages.",
            )
            job.status, job.phase = "completed", "completed"
            await session.commit()
    except ImportCancelled as exc:
        await session.rollback()
        job = await session.get(ImportJob, job_id)
        if job:
            job.status, job.phase = "cancelled", "cancelled"
            await log(session, job, "warning", "cancelled", str(exc))
            await session.commit()
    except Exception as exc:  # noqa: BLE001 - persist any worker failure for the operator
        await session.rollback()
        job = await session.get(ImportJob, job_id)
        if job:
            job.status, job.phase, job.error = "failed", "failed", str(exc)
            await log(session, job, "error", "failed", str(exc))
            await session.commit()
