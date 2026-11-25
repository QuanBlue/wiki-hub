"""HTML source preparation and table/block style preservation for Pandoc."""

from __future__ import annotations

import itertools
import re
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag
from soupsieve import SelectorSyntaxError

from app.modules.document_import.docx_formatting import (
    _direct_html_table_rows,
    _merge_inline_style,
)

# --------------------------------------------------------------------------
# Word's "Save as Web Page" export
# --------------------------------------------------------------------------
#
# This export never emits `<ul>/<ol>`, and scatters empty bookmark `<span>`s
# directly inside `<tr>`. Both are fixed here, on the raw source, before
# Pandoc ever sees it - Pandoc's own HTML reader cannot recover from either
# one after the fact (see each function's docstring for why).


#: A meta-charset declaration is usually correct even when the file is not
#: actually UTF-8 - Word's HTML export declares `windows-1252` for exactly
#: the documents that need it. Pandoc does its own sniffing and does not
#: read this tag, so decoding the file ourselves first, correctly, is the
#: only way the BeautifulSoup pass below sees the real characters rather
#: than a wall of replacement characters.
_META_CHARSET_RE = re.compile(rb"charset=[\"']?([\w-]+)", re.I)


def _read_html_source(source: Path) -> str:
    raw = source.read_bytes()
    match = _META_CHARSET_RE.search(raw[:4096])
    encoding = match.group(1).decode("ascii", errors="ignore").strip() if match else ""
    if encoding:
        try:
            "".encode(encoding)
        except LookupError:
            encoding = ""
    return raw.decode(encoding or "utf-8", errors="replace")


#: A real list reference - `l<id> level<n> lfo<id>` - as opposed to the
#: literal value `Ignore` used on the inner fallback-bullet span below.
_MSO_LIST_LEVEL = re.compile(r"mso-list:\s*l\d+\s+level(\d+)\s+lfo\d+", re.I)
_MSO_LIST_IGNORE = re.compile(r"mso-list:\s*Ignore", re.I)
#: A bare number/letter marker ("1.", "a)", "1.2.3.") reads as an ordered
#: list; anything else (a bullet, a dash, a Wingdings glyph) reads as
#: unordered. The dotted-decimal branch matters on its own: a multi-level
#: numbered list ("1.1.", "2.1.2.") is exactly where getting this wrong is
#: most visible, since every nested level would otherwise fall back to a
#: bullet.
_ORDERED_LIST_MARKER = re.compile(r"^(?:\d+(?:\.\d+)*\.?|[A-Za-z][.)])$")


def _mso_list_level(paragraph: Tag) -> int | None:
    match = _MSO_LIST_LEVEL.search(str(paragraph.get("style") or ""))
    return int(match.group(1)) if match else None


def _extract_mso_list_marker(paragraph: Tag) -> str:
    """Strip Word's browser-fallback bullet/number and return its text.

    Real list rendering is left to whichever browser understands `mso-list`
    (none, in practice); every other browser - and Pandoc - is meant to fall
    back to this plain-text marker, sitting right at the front of the
    paragraph as ordinary content. Removing it here is what keeps it from
    becoming a stray "1." or "*" glued onto the item's actual text.
    """
    marker = paragraph.find("span", style=_MSO_LIST_IGNORE)
    if not isinstance(marker, Tag):
        return ""
    text = marker.get_text().strip()
    wrapper = marker.parent
    marker.decompose()
    if isinstance(wrapper, Tag) and wrapper is not paragraph and not wrapper.get_text(strip=True):
        wrapper.decompose()
    return text


def _reconstruct_mso_lists(soup: BeautifulSoup) -> None:
    """Turn Word's fake, browser-fallback list paragraphs into real lists.

    Word's "Save as Web Page" never writes `<ul>/<ol>`: every list item is an
    ordinary `<p>` whose own `style` carries `mso-list:l<id> level<n> lfo<id>`,
    with the visible bullet or number baked in as literal fallback text (see
    `_extract_mso_list_marker`). Left alone, Pandoc has no way to know these
    paragraphs were ever a list - each becomes its own paragraph, starting
    with a stray bullet character.
    """
    candidates = [p for p in soup.find_all("p") if _mso_list_level(p) is not None]
    index = 0
    while index < len(candidates):
        run = [candidates[index]]
        while True:
            # `find_next_sibling` already skips the whitespace between two
            # paragraphs (unlike the `.next_sibling` property).
            sibling = run[-1].find_next_sibling()
            if index + len(run) < len(candidates) and sibling is candidates[index + len(run)]:
                run.append(sibling)
            else:
                break
        _replace_with_nested_list(soup, run)
        index += len(run)


def _replace_with_nested_list(soup: BeautifulSoup, run: list[Tag]) -> None:
    """Build one properly nested `<ul>/<ol>` tree from a flat run of items.

    Standard flat-items-with-levels-to-nested-lists construction: a stack of
    the currently open lists, keyed by nesting level, opening a new nested
    list under the last item whenever the level goes up and closing back down
    to it when the level drops back.
    """
    stack: list[tuple[int, Tag]] = []
    # One entry per top-level list. Usually one, but a run can switch list
    # kind at the same level (bullets, then numbers): the second list then
    # sits beside the first rather than replacing it.
    roots: list[Tag] = []
    for paragraph in run:
        level = _mso_list_level(paragraph) or 1
        ordered = bool(_ORDERED_LIST_MARKER.match(_extract_mso_list_marker(paragraph)))
        list_name = "ol" if ordered else "ul"

        while stack and stack[-1][0] > level:
            stack.pop()
        # A level Pandoc/Word never actually reused (a level 3 item right
        # after a level 1, with no level 2 in between) still only opens one
        # new list, nested under whatever is currently open - reasonable
        # even though it collapses the skipped level.
        if not stack or stack[-1][0] < level or stack[-1][1].name != list_name:
            if stack and stack[-1][0] == level:
                stack.pop()
            new_list = soup.new_tag(list_name)
            if stack:
                parent_items = stack[-1][1].find_all("li", recursive=False)
                (parent_items[-1] if parent_items else stack[-1][1]).append(new_list)
            else:
                roots.append(new_list)
            stack.append((level, new_list))

        item = soup.new_tag("li")
        for child in list(paragraph.contents):
            item.append(child.extract())
        stack[-1][1].append(item)

    run[0].replace_with(roots[0])
    for previous, following in itertools.pairwise(roots):
        previous.insert_after(following)
    for paragraph in run[1:]:
        paragraph.decompose()


def _defoster_stray_table_children(soup: BeautifulSoup) -> None:
    """Reparent (or drop, if empty) a `<tr>` child that is not a cell.

    Word's export scatters empty bookmark `<span>`s as direct children of
    `<tr>`, siblings of the `<td>`s rather than nested inside one - not
    merely untidy, but invalid enough that Pandoc's HTML reader gives up on
    the whole table rather than only on the stray span: the table vanishes
    from the output entirely, replaced by a flat run of paragraphs with no
    trace of which row or column any of them came from.
    """
    for row in soup.find_all("tr"):
        cells = row.find_all(["td", "th"], recursive=False)
        for child in list(row.contents):
            if isinstance(child, Tag) and child.name in {"td", "th"}:
                continue
            text = (
                str(child).strip()
                if isinstance(child, NavigableString)
                else child.get_text(strip=True)
            )
            if text and cells:
                # Real content in the wrong place: keep it, rather than lose
                # it outright - the nearest cell is the least-wrong home.
                cells[-1].append(child.extract())
            else:
                child.extract()


def _prepare_html_source_for_pandoc(source: Path, workdir: Path) -> Path:
    """Give Pandoc a cleaned copy of an HTML upload rather than the original.

    Both fixes above have to happen before Pandoc converts the file, not
    after: by the time Pandoc's own HTML output exists, an mso-list paragraph
    has already become an ordinary paragraph indistinguishable from real
    prose, and a table Pandoc gave up on structuring has already become a
    flat run of paragraphs with nothing left connecting them to a table at
    all. There is nothing left, at that point, to reconstruct from.
    """
    try:
        soup = BeautifulSoup(_read_html_source(source), "html.parser")
        _defoster_stray_table_children(soup)
        _reconstruct_mso_lists(soup)
        cleaned = workdir / "source.msoclean.html"
        cleaned.write_text(str(soup), encoding="utf-8")
        return cleaned
    except OSError:
        # A missing optional fidelity pass must not turn into a different,
        # more confusing import failure than the one Pandoc itself would
        # raise trying to read the original file.
        return source


_HTML_FORMATTING_PROPERTIES = frozenset(
    {
        "background-color",
        "border",
        "border-collapse",
        "border-color",
        "border-style",
        "border-width",
        "color",
        "display",
        "font-family",
        "font-size",
        "font-style",
        "font-weight",
        "padding",
        "text-align",
        "text-decoration",
        "vertical-align",
        "white-space",
        "width",
    }
)

# Applying a report stylesheet requires matching every selector against every
# source node.  For multi-megabyte scanner exports this can inflate the HTML
# far beyond the editor's storage ceiling (and make an otherwise valid import
# collapse to its truncation notice).  Keep the semantic Pandoc output intact
# for these reports; table structure and text are more important than cosmetic
# source CSS.
MAX_HTML_STYLE_ENRICHMENT_BYTES = 1_000_000


def _preserve_html_table_formatting(source: Path, converted_html: str) -> str:
    """Carry safe CSS formatting from an HTML report into Pandoc's fragment.

    Pandoc keeps the table structure but does not keep a document stylesheet.
    Applying the stylesheet to the source DOM first lets us copy only the
    computed formatting onto corresponding table nodes in Pandoc's output.
    """
    try:
        if source.stat().st_size > MAX_HTML_STYLE_ENRICHMENT_BYTES:
            return converted_html
        source_soup = BeautifulSoup(_read_html_source(source), "html.parser")
    except OSError:
        return converted_html
    _apply_safe_html_styles(source_soup)
    target_soup = BeautifulSoup(converted_html or "", "html.parser")
    _preserve_html_block_formatting(source_soup, target_soup)
    source_tables = source_soup.find_all("table")
    target_tables = target_soup.find_all("table")
    for source_table, target_table in zip(source_tables, target_tables, strict=False):
        _copy_safe_style(source_table, target_table)
        source_rows = _direct_html_table_rows(source_table)
        target_rows = _direct_html_table_rows(target_table)
        for source_row, target_row in zip(source_rows, target_rows, strict=False):
            _copy_safe_style(source_row, target_row)
            row_style = _safe_css_declarations(str(source_row.get("style") or ""))
            source_cells = source_row.find_all(["th", "td"], recursive=False)
            target_cells = target_row.find_all(["th", "td"], recursive=False)
            for source_cell, target_cell in zip(source_cells, target_cells, strict=False):
                _copy_safe_style(source_cell, target_cell)
                if row_style.get("background-color") and not _safe_css_declarations(
                    str(source_cell.get("style") or "")
                ).get("background-color"):
                    _merge_inline_style(
                        target_cell, "background-color", row_style["background-color"]
                    )
                _apply_html_text_marks(target_cell)
        _repair_html_table_grid(source_table, target_table)
    return str(target_soup)


_FORMATTED_BLOCK_TAGS = ("p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li")
_INLINE_STYLE_PROPERTIES = ("color", "font-size")
_LIST_INHERITED_STYLE_PROPERTIES = frozenset(
    {
        "color",
        "font-family",
        "font-size",
        "font-style",
        "font-weight",
        "text-align",
        "text-decoration",
    }
)


def _preserve_html_block_formatting(source_soup: BeautifulSoup, target_soup: BeautifulSoup) -> None:
    """Copy text formatting that Pandoc intentionally omits from HTML output.

    Report styles frequently use CSS selectors instead of inline markup. The
    source stylesheet has already been reduced to the safe allowlist above;
    match like-for-like block elements outside tables, then express typography
    through marks that the Tiptap schema understands.
    """
    for name in _FORMATTED_BLOCK_TAGS:
        source_blocks = _blocks_outside_tables(source_soup, name)
        target_blocks = _blocks_outside_tables(target_soup, name)
        for source_block, target_block in zip(source_blocks, target_blocks, strict=False):
            style = _block_style(source_block)
            if not style:
                continue
            _copy_style_declarations(target_block, style)
            _apply_html_text_marks(target_block)
            _wrap_inline_text_style(target_block, style)


def _blocks_outside_tables(soup: BeautifulSoup, name: str) -> list[Tag]:
    return [element for element in soup.find_all(name) if element.find_parent("table") is None]


def _block_style(block: Tag) -> dict[str, str]:
    style: dict[str, str] = {}
    # List formatting (for example `ul { text-align: center }`) is inherited by
    # its list items in a browser. Make that inheritance explicit so it survives
    # Tiptap, whose list wrapper does not store arbitrary CSS attributes.
    if block.name == "li":
        parents = [parent for parent in block.parents if isinstance(parent, Tag)]
        for parent in reversed(parents):
            if parent.name in {"ul", "ol"}:
                style.update(
                    {
                        name: value
                        for name, value in _safe_css_declarations(
                            str(parent.get("style") or "")
                        ).items()
                        if name in _LIST_INHERITED_STYLE_PROPERTIES
                    }
                )
    style.update(_safe_css_declarations(str(block.get("style") or "")))
    return style


def _copy_style_declarations(target: Tag, declarations: dict[str, str]) -> None:
    for property_name, value in declarations.items():
        _merge_inline_style(target, property_name, value)


def _wrap_inline_text_style(block: Tag, style: dict[str, str]) -> None:
    inline_style = {
        name: style[name] for name in _INLINE_STYLE_PROPERTIES if name in style
    }
    if not inline_style or not block.contents:
        return
    wrapper = BeautifulSoup("", "html.parser").new_tag("span")
    wrapper["style"] = "; ".join(
        f"{name}: {value}" for name, value in inline_style.items()
    )
    for child in list(block.contents):
        child.extract()
        wrapper.append(child)
    block.append(wrapper)


def _repair_html_table_grid(source_table: Tag, target_table: Tag) -> None:
    """Remove a column that only exists because a source colspan is too wide.

    Browsers are forgiving when a report has a heading such as
    ``<th colspan=\"6\">`` followed by five-column data rows: the final grid
    column has zero visible width. Pandoc materialises that implied column,
    however, and ProseMirror faithfully displays it as a blank sixth cell.

    A real table can use colspans, so this deliberately repairs only a span
    wider than the widest *physical* row in that same source table. This is the
    malformed-report case and leaves valid merged-cell tables untouched.
    """
    source_rows = _direct_html_table_rows(source_table)
    physical_widths = [
        len(row.find_all(["th", "td"], recursive=False)) for row in source_rows
    ]
    canonical_width = max(physical_widths, default=0)
    if canonical_width < 2:
        return

    # Do nothing for a well-formed table. In particular, do not collapse a
    # valid 5-column table merely because it also has a two-cell row with a
    # normal colspan.
    has_oversized_span = any(
        _table_cell_span(cell, "colspan") > canonical_width
        for row in source_rows
        for cell in row.find_all(["th", "td"], recursive=False)
    )
    if not has_oversized_span:
        return

    for row in _direct_html_table_rows(target_table):
        occupied = 0
        for cell in list(row.find_all(["th", "td"], recursive=False)):
            span = _table_cell_span(cell, "colspan")
            remaining = canonical_width - occupied
            if remaining <= 0:
                cell.decompose()
                continue
            if span > remaining:
                if remaining == 1:
                    cell.attrs.pop("colspan", None)
                else:
                    cell["colspan"] = str(remaining)
                span = remaining
            occupied += span


def _table_cell_span(cell: Tag, attribute: str) -> int:
    try:
        return max(1, int(str(cell.get(attribute) or "1")))
    except (TypeError, ValueError):
        return 1


def _apply_safe_html_styles(soup: BeautifulSoup) -> None:
    css = "\n".join(style.get_text() for style in soup.find_all("style"))
    # Stylesheets exported by report tools commonly begin with a remote font
    # import, and some omit the optional semicolon. We never fetch remote CSS;
    # remove the whole directive before parsing local formatting rules.
    css = re.sub(r"@import\s+(?:url\([^)]*\)|[\"'][^\"']*[\"'])\s*;?", "", css, flags=re.I)
    inline_styles = {
        id(element): _safe_css_declarations(str(element.get("style") or ""))
        for element in soup.find_all(True)
    }
    priorities: dict[int, dict[str, tuple[int, int]]] = {}
    for order, match in enumerate(re.finditer(r"([^{}]+)\{([^{}]*)\}", css)):
        declarations = _safe_css_declarations(match.group(2))
        if not declarations:
            continue
        for selector in match.group(1).split(","):
            selector = selector.strip()
            # @font-face, @media and other at-rules have no DOM selector. The
            # simple report-CSS walker below deliberately handles only ordinary
            # local selectors; skipping at-rules also prevents malformed remote
            # imports from rejecting an otherwise usable HTML document.
            if not selector or selector.startswith("@"):
                continue
            try:
                elements = soup.select(selector)
            except (SelectorSyntaxError, TypeError, ValueError):
                continue
            specificity = _css_specificity(selector)
            for element in elements:
                element_id = id(element)
                element_priorities = priorities.setdefault(element_id, {})
                for property_name, value in declarations.items():
                    previous = element_priorities.get(property_name)
                    if previous is None or (specificity, order) >= previous:
                        _merge_inline_style(element, property_name, value)
                        element_priorities[property_name] = (specificity, order)
    for element in soup.find_all(True):
        for property_name, value in inline_styles.get(id(element), {}).items():
            _merge_inline_style(element, property_name, value)


def _safe_css_declarations(css: str) -> dict[str, str]:
    declarations: dict[str, str] = {}
    for declaration in css.split(";"):
        if ":" not in declaration:
            continue
        property_name, value = declaration.split(":", 1)
        property_name = property_name.strip().lower()
        value = value.strip()
        if property_name in _HTML_FORMATTING_PROPERTIES and value:
            declarations[property_name] = value
    return declarations


def _css_specificity(selector: str) -> int:
    """A small CSS specificity score sufficient for report-style selectors."""
    return (
        selector.count("#") * 100
        + (selector.count(".") + selector.count("[") + selector.count(":")) * 10
        + len(re.findall(r"(?:^|[ >+~])([a-zA-Z][\w-]*)", selector))
    )


def _copy_safe_style(source: Tag, target: Tag) -> None:
    style = _safe_css_declarations(str(source.get("style") or ""))
    if style:
        target["style"] = "; ".join(f"{name}: {value}" for name, value in style.items())


def _apply_html_text_marks(cell: Tag) -> None:
    style = _safe_css_declarations(str(cell.get("style") or ""))
    marks: list[str] = []
    if style.get("font-weight", "").lower() in {"bold", "bolder", "600", "700", "800", "900"}:
        marks.append("strong")
    if style.get("font-style", "").lower() in {"italic", "oblique"}:
        marks.append("em")
    if "underline" in style.get("text-decoration", "").lower():
        marks.append("u")
    for name in marks:
        if cell.find(name, recursive=False) is not None:
            continue
        wrapper = BeautifulSoup("", "html.parser").new_tag(name)
        for child in list(cell.contents):
            child.extract()
            wrapper.append(child)
        cell.append(wrapper)

