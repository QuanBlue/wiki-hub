"""The exact HTML shapes WikiHub's Tiptap editor round-trips.

Two importers build page content: the Confluence importer
(`app/modules/import_export/service.py`) and the document importer
(`app/modules/document_import/`). They must emit *identical* markup for the
same construct, because the editor's node parsers match on these attributes and
class names - a task list assembled slightly differently in one importer is a
task list the editor silently degrades to a bullet list.

This module is the single description of those shapes. Anything the editor
recognises by structure rather than by tag name belongs here.
"""

from __future__ import annotations

from bs4 import BeautifulSoup, Tag

#: Classes are part of the contract, not decoration: they are what makes an
#: imported task list look like one the editor produced.
TASK_LIST_CLASS = "task-list space-y-1.5 my-3 pl-1"
TASK_ITEM_CLASS = "task-list-item flex items-start gap-2 text-sm text-foreground my-1"
TASK_CHECKBOX_CLASS = "accent-primary size-4 mt-0.5 rounded border-border shrink-0 cursor-default"
TASK_BODY_CLASS = "task-body min-w-0"
TASK_BODY_CHECKED_CLASS = "task-body min-w-0 line-through text-muted-foreground"


def new_table_of_contents(soup: BeautifulSoup) -> Tag:
    """An empty node that the editor renders as WikiHub's live contents block."""
    # `div[data-type]` is already part of the importer/editor contract. Using
    # it here prevents HTML sanitizers from unwrapping an otherwise empty nav.
    return soup.new_tag("div", attrs={"data-type": "tableOfContents"})


def new_task_list(soup: BeautifulSoup) -> Tag:
    """An empty `<ul data-type="taskList">` ready for `new_task_item` children."""
    return soup.new_tag("ul", attrs={"class": TASK_LIST_CLASS, "data-type": "taskList"})


def new_task_item(soup: BeautifulSoup, *, body: Tag | str, checked: bool) -> Tag:
    """One task row: the disabled checkbox plus the body span the editor edits.

    `body` may be a parsed tag (whose children are moved in) or a raw HTML
    string, which is parsed here - the two importers have it in both forms.
    """
    item = soup.new_tag(
        "li",
        attrs={
            "class": TASK_ITEM_CLASS,
            "data-type": "taskItem",
            "data-checked": "true" if checked else "false",
        },
    )

    checkbox = soup.new_tag("input", attrs={"type": "checkbox", "class": TASK_CHECKBOX_CLASS})
    if checked:
        checkbox["checked"] = "checked"
    # Always disabled: page content is read-only until it is opened in the
    # editor, and a live checkbox in the reader would look like it saves.
    checkbox["disabled"] = "disabled"

    span = soup.new_tag(
        "span",
        attrs={"class": TASK_BODY_CHECKED_CLASS if checked else TASK_BODY_CLASS},
    )
    if isinstance(body, Tag):
        for child in list(body.contents):
            span.append(child.extract())
    else:
        for child in list(BeautifulSoup(body, "html.parser").contents):
            span.append(child)

    item.append(checkbox)
    item.append(span)
    return item
