"""The emails this feature sends, as a plain-text body plus a styled HTML one.

Two kinds go out: the notification an administrator's mailbox sends itself when
someone uses the sign-in page's contact form, and the message that tells a
person their account was created or their password reset.

The HTML follows the application's own look - the same neutral surfaces, text
colours and rounded card as the pages, with the workspace's brand colour on the
header, links and button - so it reads as part of WikiHub rather than as a stray
system mail. It is built the way email clients require: tables and inline styles
(no stylesheet, no images that could be blocked, no scripts), and a plain-text
alternative for clients that will not show it.

Every value that came from a person is escaped before it reaches the markup.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from html import escape

# The application's neutral tokens (see ``--wh-neutral-*`` in globals.css).
_BACKGROUND = "#f7f8fa"
_SURFACE = "#ffffff"
_BORDER = "#e2e5eb"
_TEXT = "#161b24"
_MUTED = "#6b7484"
_FONT = (
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,"
    "'Noto Sans',sans-serif"
)
_MONO = "SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace"

# The brand palettes the admin can choose in Theme & Branding: the 600 shade
# (buttons, links, header), the 700 (hover/dark) and the 50 (tint).
_PRESETS: dict[str, tuple[str, str, str]] = {
    "blue": ("#216fc0", "#1d579b", "#edf6ff"),
    "emerald": ("#16a34a", "#15803d", "#f0fdf4"),
    "indigo": ("#4f46e5", "#4338ca", "#eef2ff"),
    "violet": ("#7c3aed", "#6d28d9", "#f5f3ff"),
    "rose": ("#e11d48", "#be123c", "#fff1f2"),
    "amber": ("#d97706", "#b45309", "#fffbeb"),
    "teal": ("#0d9488", "#0f766e", "#f0fdfa"),
    "slate": ("#475569", "#334155", "#f8fafc"),
}


def _mix(rgb: tuple[int, int, int], base: int, weight: float) -> str:
    # Round half up, like the app's own shading (JavaScript's Math.round);
    # Python's round() goes to the even number and would differ by one.
    channels = [int(c * weight + base * (1 - weight) + 0.5) for c in rgb]
    return "#{:02x}{:02x}{:02x}".format(*channels)


@dataclass(frozen=True)
class Brand:
    """The workspace's name, colours and mark, as the administrator set them
    under Theme &amp; Branding - the same identity every page in the app shows."""

    site_name: str = "WikiHub"
    primary: str = _PRESETS["blue"][0]
    dark: str = _PRESETS["blue"][1]
    tint: str = _PRESETS["blue"][2]
    #: A fully uploaded logo image. Without one, the mark is a plain
    #: initial-letter monogram - see `_icon_html` for why it is not the app's
    #: own SVG glyph.
    custom_logo_url: str | None = None

    @classmethod
    def from_settings(
        cls,
        site_name: str,
        theme_color: str | None,
        *,
        custom_logo_url: str | None = None,
    ) -> Brand:
        choice = (theme_color or "blue").strip().lower()
        if choice in _PRESETS:
            primary, dark, tint = _PRESETS[choice]
            return cls(site_name, primary, dark, tint, custom_logo_url)
        digits = choice.removeprefix("#")
        if len(digits) == 3:
            digits = "".join(c * 2 for c in digits)
        try:
            rgb = (int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16))
            if len(digits) != 6:
                raise ValueError
        except ValueError:
            return cls(site_name, custom_logo_url=custom_logo_url)
        # The same shading the app applies to a custom colour.
        return cls(
            site_name,
            _mix(rgb, 0, 0.85),
            _mix(rgb, 0, 0.7),
            _mix(rgb, 255, 0.08),
            custom_logo_url,
        )

    @property
    def initial(self) -> str:
        return (self.site_name.strip()[:1] or "W").upper()




@dataclass(frozen=True)
class Signature:
    """Who the message is from, closing it the way a person would."""

    name: str
    title: str
    email: str | None = None
    url: str | None = None


@dataclass(frozen=True)
class Row:
    label: str
    value: str
    #: Makes the value a link (``mailto:`` for an address).
    href: str | None = None
    note: str | None = None


@dataclass(frozen=True)
class EmailContent:
    preheader: str
    title: str
    paragraphs: list[str]
    rows: list[Row] = field(default_factory=list)
    #: A person's own words, shown as a quotation.
    quote_label: str | None = None
    quote: str | None = None
    #: Sign-in details, set in a monospace box so they can be copied exactly.
    credentials: list[Row] = field(default_factory=list)
    notice: str | None = None
    button: tuple[str, str] | None = None
    closing: str | None = None
    signature: Signature | None = None
    footer: str = ""
    #: When set, must be a trailing substring of ``title`` (e.g. the person's
    #: name in "New request from Alice") - that part of the heading is set in
    #: the brand colour instead of the plain heading colour.
    title_highlight: str | None = None


def _e(value: str) -> str:
    return escape(value, quote=True)


def _paragraph_html(text: str) -> str:
    return (
        f'<p style="margin:0 0 10px;font-family:{_FONT};font-size:14px;line-height:22px;'
        f'color:{_TEXT};">{_e(text)}</p>'
    )


def _rows_html(rows: list[Row], brand: Brand) -> str:
    cells = []
    for index, row in enumerate(rows):
        value = _e(row.value)
        if row.href:
            value = (
                f'<a href="{_e(row.href)}" style="font-family:{_FONT};color:{brand.primary};'
                f'text-decoration:none;">{value}</a>'
            )
        note = (
            f'<span style="margin-left:8px;font-family:{_FONT};font-size:12px;color:{_MUTED};">'
            f"{_e(row.note)}</span>"
            if row.note
            else ""
        )
        border = "" if index == len(rows) - 1 else f"border-bottom:1px solid {_BORDER};"
        cells.append(
            f'<tr><td valign="top" width="110" style="padding:6px 12px 6px 0;{border}'
            f'font-family:{_FONT};font-size:13px;line-height:20px;color:{_MUTED};">{_e(row.label)}</td>'
            f'<td valign="top" style="padding:6px 0;{border}font-family:{_FONT};font-size:14px;'
            f'line-height:20px;color:{_TEXT};">{value}{note}</td></tr>'
        )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="margin:4px 0 14px;border-top:1px solid {_BORDER};'
        f'border-bottom:1px solid {_BORDER};">{"".join(cells)}</table>'
    )


def _credentials_html(rows: list[Row], brand: Brand) -> str:
    lines = "".join(
        f'<tr><td style="padding:4px 0;font-family:{_FONT};font-size:13px;color:{_MUTED};" '
        f'width="130">{_e(row.label)}</td>'
        f'<td style="padding:4px 0;font-family:{_MONO};font-size:15px;font-weight:600;'
        f'color:{_TEXT};">{_e(row.value)}</td></tr>'
        for row in rows
    )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="margin:4px 0 12px;background:{_BACKGROUND};border:1px solid {_BORDER};'
        f'border-radius:8px;border-collapse:separate;">'
        f'<tr><td style="padding:8px 14px;"><table role="presentation" cellpadding="0" '
        f'cellspacing="0" width="100%">{lines}</table></td></tr></table>'
    )


def render(brand: Brand, content: EmailContent) -> tuple[str, str]:
    """Return ``(plain_text, html)`` for one message."""
    return _render_text(brand, content), _render_html(brand, content)


def _icon_html(brand: Brand, *, size: int, invert: bool) -> str:
    """The workspace's mark, sized and coloured for wherever it sits - a plain
    initial-letter monogram in a table cell, not the app's own SVG glyph.

    A number of real mail clients strip `<svg>` outright as a precaution
    (confirmed first-hand: a request-notification email opened in a corporate
    inbox lost the mark, the header wordmark's blue canvas and the card's
    white background all together, because all three sat inside or depended
    on the same stripped element). Nothing here uses `<svg>`, so
    there is nothing for that kind of client to strip. An uploaded logo is the
    one exception: a plain `<img>` degrades the ordinary way email images
    already do (blocked until "show images" is chosen, never silently gone).

    ``invert`` is True for the header, where the mark rides on the blue canvas
    and needs a light badge to read; False for the signature, where it sits on
    the white card and reads as an ordinary coloured badge instead - the same
    swap the app itself makes between a light toolbar and a dark surface.
    """
    radius = max(4, size // 4)
    if brand.custom_logo_url:
        return (
            f'<img src="{_e(brand.custom_logo_url)}" width="{size}" height="{size}" alt="" '
            f'style="display:block;width:{size}px;height:{size}px;border-radius:{radius}px;'
            'object-fit:cover;">'
        )
    box_bg, text_color = ("#ffffff", brand.primary) if invert else (brand.primary, "#ffffff")
    font_size = max(11, round(size * 0.46))
    return (
        f'<table role="presentation" width="{size}" height="{size}" cellpadding="0" '
        f'cellspacing="0" style="width:{size}px;height:{size}px;"><tr>'
        f'<td align="center" valign="middle" width="{size}" height="{size}" '
        f'bgcolor="{box_bg}" style="background:{box_bg};border-radius:{radius}px;'
        f'font-family:{_FONT};font-size:{font_size}px;font-weight:700;line-height:1;'
        f'color:{text_color};">{_e(brand.initial)}</td></tr></table>'
    )


def _logo_html(brand: Brand) -> str:
    """The header's mark and site name, on the blue canvas."""
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        f'<td width="28" height="28">{_icon_html(brand, size=28, invert=True)}</td>'
        f'<td style="padding-left:9px;font-family:{_FONT};font-size:15px;font-weight:700;'
        f'letter-spacing:-0.01em;color:#ffffff;">{_e(brand.site_name)}</td></tr></table>'
    )


def _title_html(brand: Brand, content: EmailContent) -> str:
    open_tag = (
        f'<h1 style="margin:0 0 10px;font-family:{_FONT};font-size:20px;line-height:28px;'
        "font-weight:700;letter-spacing:-0.01em;"
    )
    highlight = content.title_highlight
    if highlight and content.title.endswith(highlight):
        prefix = content.title[: -len(highlight)]
        return (
            f'{open_tag}color:{_TEXT};">{_e(prefix)}'
            f'<span style="font-family:{_FONT};color:{brand.primary};">{_e(highlight)}</span></h1>'
        )
    return f'{open_tag}color:{_TEXT};">{_e(content.title)}</h1>'


def _render_html(brand: Brand, content: EmailContent) -> str:
    parts: list[str] = []
    parts.append(_title_html(brand, content))
    parts.extend(_paragraph_html(text) for text in content.paragraphs)
    if content.rows:
        parts.append(_rows_html(content.rows, brand))
    if content.credentials:
        parts.append(_credentials_html(content.credentials, brand))
    if content.quote is not None:
        label = (
            f'<div style="margin:0 0 6px;font-family:{_FONT};font-size:12px;font-weight:600;'
            f'color:{_MUTED};">{_e(content.quote_label)}</div>'
            if content.quote_label
            else ""
        )
        body = _e(content.quote).replace("\n", "<br>")
        parts.append(
            f'{label}<div style="margin:0 0 14px;padding:10px 14px;background:{_BACKGROUND};'
            f"border-radius:8px;font-family:{_FONT};font-size:14px;line-height:22px;"
            f'color:{_TEXT};">{body}</div>'
        )
    if content.notice:
        parts.append(
            f'<p style="margin:0 0 12px;font-family:{_FONT};font-size:12px;line-height:18px;'
            f'color:{_MUTED};">{_e(content.notice)}</p>'
        )
    if content.button:
        label, url = content.button
        # The fill colour is set three ways at once - `bgcolor` on the `<td>`,
        # `background` in its `style`, and `background` again directly on the
        # `<a>` - because a security-conscious client that strips styling
        # around a link (seen first-hand: a button that rendered as bare,
        # unstyled text in a real inbox, everything else on the message
        # untouched) may drop some of those and not others. The border on the
        # `<a>` is the last line of defence: even with every fill colour gone,
        # a visible outline still reads as a button rather than plain text.
        parts.append(
            '<table role="presentation" cellpadding="0" cellspacing="0" '
            'style="margin:2px 0 14px;">'
            f'<tr><td bgcolor="{brand.primary}" style="background:{brand.primary};'
            f'border-radius:8px;">'
            f'<a href="{_e(url)}" style="display:inline-block;padding:9px 21px;'
            f'font-family:{_FONT};font-size:14px;'
            f"font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;"
            f'border-radius:8px;background:{brand.primary};'
            f'border:1px solid {brand.dark};">{_e(label)}</a></td></tr></table>'
        )
    if content.closing:
        parts.append(
            f'<p style="margin:0 0 4px;font-family:{_FONT};font-size:12px;line-height:18px;'
            f'color:{_MUTED};">{_e(content.closing)}</p>'
        )
    parts.append(_signature_html(brand, content.signature))

    card = "".join(parts)
    logo = _logo_html(brand)
    # The page itself is neutral, not the brand colour: a reading pane taller
    # than the message (the ordinary case - most of these are a few short
    # lines) fills whatever is left over with the `<body>` background, and a
    # real inbox showed that as a wall of solid blue stretching well past the
    # card. A colour bounded to the header bar can only ever do that in
    # miniature. The page itself is `brand.tint` - a pale, faint wash of the
    # same colour (already what the app uses for this - see `Brand.tint`) -
    # rather than the neutral `_BACKGROUND` grey the white card also sits
    # close to: a real inbox showed the two blending into each other with
    # barely a shadow between them. The tint is nowhere near as strong as the
    # solid canvas this replaced, so filling unbounded leftover space with it
    # still reads as a calm page, not a wall of colour.
    page = brand.tint
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light">'
        '<meta name="supported-color-schemes" content="light">'
        f"<title>{_e(content.title)}</title></head>"
        f'<body bgcolor="{page}" style="margin:0;padding:0;background:{page};'
        f'font-family:{_FONT};">'
        # Shown next to the subject in the inbox list, hidden in the message.
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{page};">'
        f"{_e(content.preheader)}</div>"
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:{page};"><tr>'
        f'<td align="center" bgcolor="{page}" style="background:{page};padding:28px 12px;">'
        # Deliberately the same fixed pixel value on both the HTML `width`
        # attribute and the CSS `width` - not `width:100%` - because a real
        # inbox showed a client that reads inline `style` (the card's other
        # colours all came through) but not `max-width`: with `width:100%`
        # there, that property alone stretched the card the full span of the
        # reading pane regardless of what the attribute said, since CSS wins
        # over a presentational attribute wherever both are read. Pinning the
        # CSS width to 560px too closes that gap - every client lands on the
        # same fixed width, whichever of the two it goes by.
        f'<table role="presentation" width="560" cellpadding="0" cellspacing="0" '
        f'style="width:560px;max-width:560px;">'
        # The brand colour lives here now - a header bar bounded to the
        # card's own width and height, never the leftover space around it.
        f'<tr><td bgcolor="{brand.primary}" style="background:{brand.primary};'
        f'border-radius:12px 12px 0 0;padding:16px 24px;">{logo}</td></tr>'
        f'<tr><td bgcolor="{_SURFACE}" style="background:{_SURFACE};'
        f"border-radius:0 0 12px 12px;padding:22px 24px 18px;"
        f'font-family:{_FONT};">{card}</td></tr>'
        f'<tr><td align="center" style="padding:12px 8px 0;font-family:{_FONT};font-size:12px;'
        f'line-height:18px;color:{_MUTED};text-align:center;">{_e(content.footer)}</td></tr></table>'
        "</td></tr></table></body></html>"
    )


def _signature_html(brand: Brand, signature: Signature | None) -> str:
    """A compact corporate-style block: a logo badge beside the name, then one
    labelled line per contact detail (label bold in the brand colour, value in
    body text) - the layout of a typical company email signature, built from
    whatever `Signature` actually carries rather than fields WikiHub has no
    data for (title/department, phone, office address)."""
    if signature is None:
        return ""
    rows: list[tuple[str, str]] = []
    if signature.email:
        rows.append(
            (
                "Email",
                f'<a href="mailto:{_e(signature.email)}" style="font-family:{_FONT};'
                f'color:{_TEXT};text-decoration:none;">{_e(signature.email)}</a>',
            )
        )
    if signature.url:
        host = signature.url.removeprefix("https://").removeprefix("http://").rstrip("/")
        rows.append(
            (
                "Web",
                f'<a href="{_e(signature.url)}" style="font-family:{_FONT};color:{_TEXT};'
                f'text-decoration:none;">{_e(host)}</a>',
            )
        )
    contact_html = "".join(
        f'<div style="margin-top:2px;font-family:{_FONT};font-size:12px;line-height:18px;">'
        f'<span style="font-weight:700;color:{brand.primary};">{_e(label)}:</span> '
        f'<span style="color:{_MUTED};">{value}</span></div>'
        for label, value in rows
    )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="margin-top:14px;border-top:1px solid {_BORDER};">'
        '<tr><td style="padding-top:14px;">'
        f'<div style="font-family:{_FONT};font-size:12px;line-height:18px;color:{_MUTED};'
        'margin-bottom:6px;">Best regards,</div>'
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        f'<td width="34" valign="top" style="padding-right:10px;">'
        f"{_icon_html(brand, size=34, invert=False)}</td>"
        '<td valign="top">'
        # Who signed it, in the workspace's own colour and set apart the way a
        # signed-off name in a real signature block is - not just bold body text.
        f'<div style="font-family:{_FONT};font-size:14px;line-height:19px;font-weight:700;'
        f'letter-spacing:0.01em;color:{brand.primary};">{_e(signature.name)}</div>'
        f'<div style="margin-top:1px;font-family:{_FONT};font-size:12px;line-height:18px;'
        f'font-weight:600;color:{_TEXT};">{_e(signature.title)}</div>'
        f"{contact_html}"
        "</td></tr></table>"
        "</td></tr></table>"
    )


def _render_text(brand: Brand, content: EmailContent) -> str:
    lines: list[str] = [content.title, ""]
    for text in content.paragraphs:
        lines += [text, ""]
    for row in content.rows:
        value = f"{row.value} ({row.note})" if row.note else row.value
        lines.append(f"{row.label}: {value}")
    if content.rows:
        lines.append("")
    for row in content.credentials:
        lines.append(f"{row.label}: {row.value}")
    if content.credentials:
        lines.append("")
    if content.quote is not None:
        if content.quote_label:
            lines.append(f"{content.quote_label}:")
        lines += [content.quote, ""]
    if content.notice:
        lines += [content.notice, ""]
    if content.button:
        lines += [f"{content.button[0]}: {content.button[1]}", ""]
    if content.closing:
        lines += [content.closing, ""]
    if content.signature:
        sig = content.signature
        lines += ["--", "Best regards,", sig.name, sig.title]
        contact = " · ".join(part for part in (sig.email, sig.url) if part)
        if contact:
            lines.append(contact)
        lines.append("")
    if content.footer:
        lines.append(content.footer)
    return "\n".join(lines).rstrip() + "\n"


# --- the messages themselves --------------------------------------------------

_KIND_LABELS = {
    "account": "Account request",
    "password_reset": "Password reset request",
    "other": "Request",
}


_NEW_LABELS = {
    "account": "New account request",
    "password_reset": "New password reset request",
    "other": "New request",
}


def request_notification(
    brand: Brand,
    *,
    kind: str,
    name: str,
    email: str,
    username: str | None,
    message: str,
    received_at: datetime,
    inbox_url: str | None,
) -> tuple[str, str]:
    """What an administrator's mailbox sends itself when someone asks for help."""
    label = _KIND_LABELS.get(kind, "Request")
    return render(
        brand,
        EmailContent(
            preheader=f"{name} sent a {label.lower()} from the {brand.site_name} sign-in page.",
            title=f"{_NEW_LABELS.get(kind, 'New request')} from {name}",
            # The requester's own name, set apart from the rest of the heading.
            title_highlight=name,
            paragraphs=[
                f"Someone used the {brand.site_name} sign-in page to ask an administrator for help."
            ],
            rows=[
                Row("Type", label),
                Row("Name", name),
                Row("Email", email, href=f"mailto:{email}", note="as typed, not verified"),
                Row("Username", username or "-"),
                Row("Received", received_at.strftime("%d %b %Y, %H:%M UTC")),
            ],
            quote_label="Message",
            quote=message or "(No message was written.)",
            button=("Open Requests", inbox_url) if inbox_url else None,
            closing="Reply to this email to answer them directly.",
            signature=Signature(
                name=f"{brand.site_name} notifications",
                title="Sent automatically from the sign-in page",
                url=inbox_url.rsplit("/admin/inbox", 1)[0] if inbox_url else None,
            ),
            footer=(
                f"You are receiving this because this mailbox receives {brand.site_name} "
                "administrator requests."
            ),
        ),
    )


def account_details(
    brand: Brand,
    *,
    created: bool,
    name: str,
    username: str,
    password: str,
    login_url: str | None,
    signature: Signature,
) -> tuple[str, str]:
    """Tells a person their account exists (or its password was reset)."""
    greeting = f"Hello {' '.join(name.split()) or username},"
    if created:
        title = "Your account is ready"
        intro = f"An administrator has created a {brand.site_name} account for you."
    else:
        title = "Your password was reset"
        intro = "An administrator has reset the password for your account."
    return render(
        brand,
        EmailContent(
            preheader=f"{intro} Sign in with the details inside.",
            title=title,
            paragraphs=[f"{greeting} {intro[0].lower()}{intro[1:]}"],
            credentials=[Row("Username", username), Row("Temporary password", password)],
            notice=(
                "Please change this password after you sign in (Account settings), and do not "
                "share it with anyone. If you did not ask for this, tell your administrator."
            ),
            button=("Sign in", login_url) if login_url else None,
            signature=signature,
            footer=f"This message was sent by a {brand.site_name} administrator.",
        ),
    )


def admin_granted(
    brand: Brand,
    *,
    name: str,
    username: str,
    login_url: str | None,
    signature: Signature,
) -> tuple[str, str]:
    """Tells a person their account was made a WikiHub administrator."""
    greeting = f"Hello {' '.join(name.split()) or username},"
    intro = f"An administrator has made your account a {brand.site_name} administrator."
    return render(
        brand,
        EmailContent(
            preheader=intro,
            title="You're now an administrator",
            paragraphs=[f"{greeting} {intro[0].lower()}{intro[1:]}"],
            notice=(
                "Administrators can manage every space, user and site setting. If this "
                "was not expected, tell whoever granted it to you."
            ),
            button=("Open WikiHub", login_url) if login_url else None,
            signature=signature,
            footer=f"This message was sent by a {brand.site_name} administrator.",
        ),
    )


def space_access_changed(
    brand: Brand,
    *,
    name: str,
    username: str,
    space_name: str,
    added: bool,
    login_url: str | None,
    signature: Signature,
) -> tuple[str, str]:
    """Tells a person they were added to, or removed from, a space."""
    greeting = f"Hello {' '.join(name.split()) or username},"
    if added:
        title = "You've been added to a space"
        intro = f'An administrator has given you access to the space "{space_name}".'
    else:
        title = "You've been removed from a space"
        intro = f'An administrator has removed your access to the space "{space_name}".'
    return render(
        brand,
        EmailContent(
            preheader=intro,
            title=title,
            paragraphs=[f"{greeting} {intro[0].lower()}{intro[1:]}"],
            # Nothing useful to sign in for if access was just taken away.
            button=("Open WikiHub", login_url) if added and login_url else None,
            signature=signature,
            footer=f"This message was sent by a {brand.site_name} administrator.",
        ),
    )


def issue_closed(
    brand: Brand,
    *,
    name: str,
    username: str,
    issue_title: str,
    closed_by: str,
    taken_by: str | None,
    note: str | None,
    issues_url: str | None,
    signature: Signature,
) -> tuple[str, str]:
    """Tells the person who reported an issue that it has been dealt with."""
    greeting = f"Hello {' '.join(name.split()) or username},"
    intro = f'{closed_by} has closed the issue you reported: "{issue_title}".'
    rows = [Row("Issue", issue_title), Row("Closed by", closed_by)]
    if taken_by and taken_by != closed_by:
        rows.append(Row("Taken by", taken_by))
    return render(
        brand,
        EmailContent(
            preheader=intro,
            title="Your issue was closed",
            paragraphs=[f"{greeting} {intro[0].lower()}{intro[1:]}"],
            rows=rows,
            quote_label=f"Note from {closed_by}" if note else None,
            quote=note or None,
            button=("View my issues", issues_url) if issues_url else None,
            closing="If this did not fix it, report the issue again and mention this one.",
            signature=signature,
            footer=f"This message was sent by a {brand.site_name} administrator.",
        ),
    )


def issue_created(
    brand: Brand,
    *,
    name: str,
    username: str,
    reporter: str,
    issue_title: str,
    description: str,
    issue_url: str | None,
) -> tuple[str, str]:
    """Tells someone who manages issues that a new one was reported."""
    greeting = f"Hello {' '.join(name.split()) or username},"
    excerpt = " ".join(description.split())
    if len(excerpt) > 400:
        excerpt = excerpt[:400].rstrip() + "..."
    return render(
        brand,
        EmailContent(
            preheader=f'{reporter} reported "{issue_title}".',
            title=f"New issue from {reporter}",
            title_highlight=reporter,
            paragraphs=[f"{greeting} a new issue was reported in {brand.site_name}."],
            rows=[Row("Issue", issue_title), Row("Reported by", reporter)],
            quote_label="Description" if excerpt else None,
            quote=excerpt or None,
            button=("Open issue", issue_url) if issue_url else None,
            closing="Take it to put your name on it, then mark it done when it is fixed.",
            signature=Signature(
                name=f"{brand.site_name} notifications",
                title="Sent automatically when an issue is reported",
                url=issue_url.split("/admin/issues", 1)[0] if issue_url else None,
            ),
            footer=f"You are receiving this because you can manage {brand.site_name} issues.",
        ),
    )
