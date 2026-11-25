"""Page templates module."""

from __future__ import annotations

from app.modules.templates.builtins import (
    BUILTIN_PREFIX,
    BUILTIN_SLUGS,
    get_builtin_template,
    is_builtin_template_id,
    list_builtin_templates,
)
from app.modules.templates.service import PageTemplateService

__all__ = [
    "BUILTIN_PREFIX",
    "BUILTIN_SLUGS",
    "PageTemplateService",
    "get_builtin_template",
    "is_builtin_template_id",
    "list_builtin_templates",
]
