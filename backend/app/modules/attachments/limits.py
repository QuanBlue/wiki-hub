"""Per-space attachment size ceilings layered over the workspace settings.

One number for the whole instance is the wrong shape: a space of screen
recordings and a space of meeting notes want very different ceilings, and
raising the workspace limit to suit the first raises it for the second too.
A space carries its own optional ``max_upload_size_mb``; everything downstream
keeps reading the same :class:`EffectiveSettings`, only with that number
substituted, so no upload path needs to learn about spaces.
"""

from __future__ import annotations

from app.models.space import Space
from app.schemas.site_settings import EffectiveSettings


def limits_for_space(
    effective: EffectiveSettings, space: Space | None
) -> EffectiveSettings:
    """Return the settings to enforce for uploads into ``space``."""
    override = space.max_upload_size_mb if space is not None else None
    if not override or override == effective.max_upload_size_mb:
        return effective
    return effective.model_copy(
        update={
            "max_upload_size_mb": override,
            "max_upload_size_bytes": override * 1024 * 1024,
        }
    )
