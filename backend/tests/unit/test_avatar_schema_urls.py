"""Avatar URLs emitted by page and user response schemas."""

from app.schemas.page import PageRecentItem
from app.schemas.user import UserRead


def test_avatar_url_normalization_preserves_api_path_and_external_url() -> None:
    for schema in (PageRecentItem, UserRead):
        normalize = schema._normalize_avatar_url
        assert normalize(None) is None
        assert normalize("https://wiki.example/api/v1/users/alice/avatar") == (
            "/api/v1/users/alice/avatar"
        )
        assert normalize("https://cdn.example/avatar.png") == "https://cdn.example/avatar.png"
