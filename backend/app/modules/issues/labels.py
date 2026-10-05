"""The labels an issue can carry.

A fixed set, taken from GitHub's defaults: the reporter ticks the ones that fit and
the issue list filters by them. Only the slugs are stored (on the issue); the
words and colours live in the frontend.
"""

from __future__ import annotations

ISSUE_LABELS: tuple[str, ...] = (
    "bug",
    "documentation",
    "enhancement",
    "good-first-issue",
    "help-wanted",
    "question",
)

#: The filter value for issues that carry no label at all.
NO_LABEL = "none"
