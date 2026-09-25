"""Shared reads over a job's stored narration (`ImportLog` / `BackupJobLog`).

The two log tables have the same shape on purpose, so the history endpoints for
Confluence imports and WikiHub restores share these helpers instead of each
growing its own copy.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any, Literal

from sqlalchemy import Select, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

LogLevelFilter = Literal["warning", "error"]
LogOrder = Literal["asc", "desc"]


async def problem_counts(
    session: AsyncSession, log_model: type[Any], job_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int]]:
    """`{job_id: (warnings, errors)}` for many jobs in one grouped query.

    Jobs with no such lines are simply absent; callers default them to (0, 0).
    """
    ids = list(job_ids)
    if not ids:
        return {}
    rows = await session.execute(
        select(
            log_model.job_id,
            func.count(case((log_model.level == "warning", 1))),
            func.count(case((log_model.level == "error", 1))),
        )
        .where(log_model.job_id.in_(ids))
        .group_by(log_model.job_id)
    )
    return {job_id: (int(warnings), int(errors)) for job_id, warnings, errors in rows.all()}


def job_logs_query(
    log_model: type[Any],
    job_id: uuid.UUID,
    *,
    level: LogLevelFilter | None = None,
    order: LogOrder = "desc",
) -> Select[Any]:
    """One job's lines, optionally only one level, in a stable order."""
    query = select(log_model).where(log_model.job_id == job_id)
    if level is not None:
        query = query.where(log_model.level == level)
    if order == "asc":
        return query.order_by(log_model.created_at.asc(), log_model.id.asc())
    return query.order_by(log_model.created_at.desc(), log_model.id.desc())


def format_log_line(entry: Any) -> str:
    """One plain-text line: `2026-09-24T18:51:23+00:00 WARNING attachments file.pdf: message`."""
    label = f" {entry.entity_label}:" if entry.entity_label else ""
    return (
        f"{entry.created_at.isoformat()} {entry.level.upper()} {entry.phase}{label} "
        f"{entry.message}"
    )
