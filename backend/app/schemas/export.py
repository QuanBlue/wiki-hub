"""The bundle handed to the chrome-less /print route so it can render a page
identically to the live view, without ever touching a real session."""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel


class ExportBundlePage(BaseModel):
    id: uuid.UUID
    title: str
    slug: str
    #: Sanitized, toggle-forced-open, attachment-inlined HTML - see
    #: app/modules/pages/export_content.py. Self-contained: no further fetch
    #: back to the API is needed to render it.
    content: str


class ExportBundleSpace(BaseModel):
    key: str
    name: str
    font_family: str | None = None


class ExportBundleSite(BaseModel):
    site_name: str
    theme_color: str
    default_font: str


class ExportBundle(BaseModel):
    page: ExportBundlePage
    space: ExportBundleSpace
    site: ExportBundleSite
    #: Reserved for a future dark-mode export; PDF/HTML/Word all render light
    #: today regardless of the viewer's own theme preference, since a static
    #: document has no viewer-side toggle to honour.
    theme: Literal["light", "dark"] = "light"
