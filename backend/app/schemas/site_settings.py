"""Site settings schemas.

The read shape returns **both** the raw overrides and the effective values.
That is what lets the UI say "Site name: WikiHub (inherited from environment)"
and offer a Reset control — with only the effective value, an administrator
cannot tell a deliberate setting from an inherited default.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

AppRole = Literal["admin", "member"]
AnnouncementLevel = Literal["info", "warning", "danger", "success"]
SeasonalEffectPresetId = Literal[
    "none",
    "new_year",
    "lunar_new_year",
    "floral_pink",
    "heritage_gold",
    "national_red_gold",
    "lotus_gold",
    "memorial_candle",
    "mid_autumn",
    "halloween",
    "blue_neon",
    "christmas",
    "valentine",
    "spring_green",
    "easter",
    "kids_party",
    "autumn_harvest",
    "teachers_day",
]
#: ``easter`` = Western Easter Sunday; ``weekday`` = Nth weekday of a month
#: (e.g. Mother's Day, Thanksgiving). Both derive their window from
#: ``window_before`` / ``window_after`` instead of the fixed start/end fields.
SeasonalCalendarType = Literal["solar", "lunar", "easter", "weekday"]
SeasonalThemeMode = Literal["off", "auto", "manual"]


def _strip_empty_html(value: str) -> str:
    """Return plain text extracted from HTML to detect visually empty editor output."""
    text = re.sub(r"<[^>]+>", "", value).replace("&nbsp;", " ").strip()
    return text


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class LoginPanelFeature(BaseModel):
    """One of the three feature blurbs on the sign-in page."""

    enabled: bool = True
    title: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=240)

    @field_validator("title", "description")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return _blank_to_none(value)


def _three_blank_features() -> list[LoginPanelFeature]:
    return [LoginPanelFeature() for _ in range(3)]


class LoginPanelCopy(BaseModel):
    """Sign-in page text for one language. ``None`` = the built-in default."""

    tagline: str | None = Field(default=None, max_length=120)
    headline: str | None = Field(default=None, max_length=160)
    subheading: str | None = Field(default=None, max_length=600)
    footer: str | None = Field(default=None, max_length=200)
    features: list[LoginPanelFeature] = Field(default_factory=_three_blank_features)

    @field_validator("tagline", "headline", "subheading", "footer")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return _blank_to_none(value)

    @field_validator("features")
    @classmethod
    def _three_features(cls, value: list[LoginPanelFeature]) -> list[LoginPanelFeature]:
        if len(value) != 3:
            raise ValueError("The sign-in panel has exactly three feature blurbs.")
        return value


class LoginPanel(BaseModel):
    """Administrator copy for the left panel of the sign-in page."""

    en: LoginPanelCopy = Field(default_factory=LoginPanelCopy)
    vi: LoginPanelCopy = Field(default_factory=LoginPanelCopy)
    #: Hide the illustration entirely (instead of showing the default or upload).
    hide_image: bool = False

    @model_validator(mode="after")
    def _keep_one_feature(self) -> LoginPanel:
        for copy in (self.en, self.vi):
            if not any(feature.enabled for feature in copy.features):
                raise ValueError("Keep at least one feature blurb enabled.")
        return self


class SystemAnnouncement(BaseModel):
    """Top-of-page system announcement banner configured by an administrator."""

    enabled: bool = False
    level: AnnouncementLevel = "info"
    title: str | None = Field(default=None, max_length=255)
    content_html: str = Field(default="", max_length=50_000)
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    dismissible: bool = True
    show_on_login: bool = True
    updated_at: datetime | None = None

    @field_validator("title")
    @classmethod
    def _clean_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("content_html")
    @classmethod
    def _clean_content_html(cls, value: str | None) -> str:
        if not value:
            return ""
        stripped = value.strip()
        if not _strip_empty_html(stripped) and "<img" not in stripped.lower():
            return ""
        return stripped

    @field_validator("starts_at", "expires_at", "updated_at")
    @classmethod
    def _ensure_tz_aware(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    @model_validator(mode="after")
    def _validate_schedule(self) -> SystemAnnouncement:
        if (
            self.starts_at is not None
            and self.expires_at is not None
            and self.expires_at <= self.starts_at
        ):
            raise ValueError("Announcement expiry time must be after the start time.")
        return self

    def has_content(self) -> bool:
        return bool(
            (self.title and self.title.strip())
            or _strip_empty_html(self.content_html)
            or "<img" in self.content_html.lower()
        )

    def is_currently_active(self, now: datetime | None = None) -> bool:
        if not self.enabled or not self.has_content():
            return False
        current = now or datetime.now(UTC)
        if current.tzinfo is None:
            current = current.replace(tzinfo=UTC)
        if self.starts_at is not None and current < self.starts_at:
            return False
        if self.expires_at is not None and current >= self.expires_at:
            return False
        return True


def _all_app_roles() -> list[AppRole]:
    return ["admin", "member"]


def _admin_role() -> list[AppRole]:
    return ["admin"]


class SidebarPermissions(BaseModel):
    """Visibility policy for the persistent application navigation.

    These roles are intentionally the instance-level roles from the user model,
    not space roles. A page inside a space remains protected by that space's
    membership rules regardless of whether its parent navigation is visible.
    """

    # Home is the one link every signed-in user must always be able to reach,
    # so its role set is fixed the same way settings/backups are fixed below.
    home: list[AppRole] = Field(default_factory=_all_app_roles)
    spaces: list[AppRole] = Field(default_factory=_all_app_roles)
    recent: list[AppRole] = Field(default_factory=_all_app_roles)
    favorites: list[AppRole] = Field(default_factory=_all_app_roles)
    pinned: list[AppRole] = Field(default_factory=_all_app_roles)
    # Administrative routes already enforce this on the server. Keeping their
    # policy fixed prevents a member from seeing a link that can only end in a
    # 403 and ensures an administrator can always reach Settings.
    settings: list[AppRole] = Field(default_factory=_admin_role)
    backups: list[AppRole] = Field(default_factory=_admin_role)

    @field_validator("spaces", "recent", "favorites", "pinned")
    @classmethod
    def _dedupe_roles(cls, value: list[AppRole]) -> list[AppRole]:
        # An empty list is a valid, deliberate state: "hidden from everyone".
        return list(dict.fromkeys(value))

    @field_validator("home")
    @classmethod
    def _keep_home_visible(cls, value: list[AppRole]) -> list[AppRole]:
        # Coerce rather than raise: this model also parses whatever is
        # already stored on the settings row, including values saved before
        # Home became a fixed, always-visible link (e.g. a legacy row with
        # `home: ["admin"]`). Rejecting that would crash every page load
        # that reads effective settings instead of just healing it.
        return ["admin", "member"]

    @model_validator(mode="after")
    def _keep_administration_safe(self) -> SidebarPermissions:
        if self.settings != ["admin"] or self.backups != ["admin"]:
            raise ValueError("Settings and backups are available to administrators only.")
        return self


class SeasonalEventItem(BaseModel):
    """One recurring holiday/event entry (built-in or administrator-created)."""

    id: str = Field(min_length=1, max_length=64)
    builtin: bool = False
    name_en: str = Field(min_length=1, max_length=140)
    name_vi: str = Field(min_length=1, max_length=140)
    preset: SeasonalEffectPresetId = "new_year"
    calendar_type: SeasonalCalendarType = "solar"
    #: Primary date of the holiday (used for Home calendar countdown & display).
    event_month: int = Field(ge=1, le=12)
    event_day: int = Field(ge=1, le=31)
    #: Active effect window (inclusive; supports year wrap-around e.g. 12/29 -> 01/02).
    start_month: int = Field(ge=1, le=12)
    start_day: int = Field(ge=1, le=31)
    end_month: int = Field(ge=1, le=12)
    end_day: int = Field(ge=1, le=31)
    #: Official public holiday metadata (displayed on the Home calendar).
    is_public_holiday: bool = False
    holiday_days: int = Field(default=0, ge=0, le=15)
    holiday_note_en: str | None = Field(default=None, max_length=200)
    holiday_note_vi: str | None = Field(default=None, max_length=200)
    #: ``weekday`` calendars: 0 = Monday ... 6 = Sunday; 1-4 = nth, -1 = last.
    weekday: int = Field(default=0, ge=0, le=6)
    week_of_month: int = Field(default=1, ge=-1, le=5)
    #: Days before / after the date that the effect stays active
    #: (``easter`` and ``weekday`` calendars only).
    window_before: int = Field(default=2, ge=0, le=30)
    window_after: int = Field(default=1, ge=0, le=30)
    enabled: bool = True
    auto_activate: bool = True
    show_on_home_calendar: bool = True

    @field_validator("id", "name_en", "name_vi")
    @classmethod
    def _clean_required(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Field cannot be blank.")
        return stripped

    @field_validator("holiday_note_en", "holiday_note_vi")
    @classmethod
    def _clean_optional(cls, value: str | None) -> str | None:
        return _blank_to_none(value)


def _default_seasonal_events_factory() -> list[SeasonalEventItem]:
    from app.services.seasonal_theme import default_seasonal_events

    return default_seasonal_events()


class SeasonalThemeSettings(BaseModel):
    """Administrator configuration for global seasonal / holiday effects."""

    mode: SeasonalThemeMode = "auto"
    manual_preset: SeasonalEffectPresetId = "none"
    reminder_enabled: bool = True
    reminder_days_before: int = Field(default=7, ge=1, le=30)
    reminder_send_email: bool = True
    events: list[SeasonalEventItem] = Field(default_factory=_default_seasonal_events_factory)
    #: Maps ``"<event_id>:<year>"`` -> ISO timestamp to prevent duplicate reminders.
    notified_occurrences: dict[str, str] = Field(default_factory=dict)

    @field_validator("events")
    @classmethod
    def _unique_event_ids(cls, value: list[SeasonalEventItem]) -> list[SeasonalEventItem]:
        seen: set[str] = set()
        deduped: list[SeasonalEventItem] = []
        for item in value:
            if item.id in seen:
                continue
            seen.add(item.id)
            deduped.append(item)
        return deduped[:60]


class ActiveSeasonalTheme(BaseModel):
    """Resolved active seasonal effect exposed via ``/api/v1/meta`` to all users."""

    preset: SeasonalEffectPresetId = "none"
    event_id: str | None = None
    event_name_en: str | None = None
    event_name_vi: str | None = None
    source: SeasonalThemeMode = "off"


class UpcomingSeasonalReminder(BaseModel):
    """An upcoming holiday within the admin reminder window."""

    event_id: str
    occurrence_key: str
    name_en: str
    name_vi: str
    preset: SeasonalEffectPresetId
    event_date: date
    starts_on: date
    ends_on: date
    days_until: int
    auto_activate: bool


class SeasonalCalendarEntry(BaseModel):
    """One resolved holiday entry for the Home page upcoming calendar."""

    event_id: str
    name_en: str
    name_vi: str
    preset: SeasonalEffectPresetId
    calendar_type: SeasonalCalendarType
    lunar_label: str | None = None
    event_date: date
    starts_on: date
    ends_on: date
    days_until: int
    is_active: bool
    is_today: bool
    is_public_holiday: bool
    holiday_days: int
    holiday_note_en: str | None = None
    holiday_note_vi: str | None = None


class SeasonalActivateRequest(BaseModel):
    """Quick-activate a seasonal preset from the admin reminder banner."""

    preset: SeasonalEffectPresetId


class SiteSettingsOverrides(BaseModel):
    """The stored values. ``None`` means "inherit from the environment"."""

    model_config = ConfigDict(from_attributes=True)

    site_name: str | None = None
    theme_color: str | None = None
    default_font: str | None = None
    logo_icon: str | None = None
    custom_logo_url: str | None = None
    max_upload_size_mb: int | None = None
    max_backup_import_size_mb: int | None = None
    allowed_attachment_types: list[str] | None = None
    sidebar_permissions: SidebarPermissions | None = None
    announcement: SystemAnnouncement | None = None
    seasonal_theme: SeasonalThemeSettings | None = None
    login_panel: LoginPanel | None = None
    session_ttl_hours: int | None = None
    trash_retention_days: int | None = None
    public_shares_enabled: bool | None = None


class EffectiveSettings(BaseModel):
    """What the application actually uses: override if set, else the env default."""

    site_name: str
    theme_color: str
    default_font: str
    logo_icon: str
    custom_logo_url: str | None
    max_upload_size_mb: int
    max_upload_size_bytes: int
    max_backup_import_size_mb: int
    max_backup_import_size_bytes: int
    allowed_attachment_types: list[str]
    sidebar_permissions: SidebarPermissions
    announcement: SystemAnnouncement = Field(default_factory=SystemAnnouncement)
    seasonal_theme: SeasonalThemeSettings = Field(default_factory=SeasonalThemeSettings)
    login_panel: LoginPanel = Field(default_factory=LoginPanel)
    #: Public URL of the uploaded sign-in illustration, ``None`` if there is none.
    login_image_url: str | None = None
    session_ttl_hours: int
    trash_retention_days: int
    public_shares_enabled: bool = True


class SiteSettingsRead(BaseModel):
    overrides: SiteSettingsOverrides
    effective: EffectiveSettings
    updated_at: datetime | None = None
    updated_by_username: str | None = None


class SidebarPermissionsRead(BaseModel):
    """The effective navigation policy, safe for every signed-in user to read."""

    permissions: SidebarPermissions


class AnnouncementRead(BaseModel):
    """The currently active system announcement (if any), safe for signed-in users."""

    announcement: SystemAnnouncement | None = None


class SiteSettingsUpdate(BaseModel):
    """Partial update.

    Distinguishing *absent* from *explicit null* is essential here and is why
    the service must test ``if "field" in data`` rather than the usual
    ``data.get(...) is not None``: sending ``null`` is how the UI resets a
    setting back to the environment default.
    """

    site_name: str | None = Field(default=None, max_length=255)
    theme_color: str | None = Field(default=None, max_length=50)
    default_font: str | None = Field(default=None, max_length=50)
    logo_icon: str | None = Field(default=None, max_length=50)
    custom_logo_url: str | None = Field(default=None, max_length=1_000_000)
    max_upload_size_mb: int | None = Field(default=None, ge=1, le=10_240)
    max_backup_import_size_mb: int | None = Field(default=None, ge=1, le=102_400)
    allowed_attachment_types: list[str] | None = Field(default=None, max_length=100)
    sidebar_permissions: SidebarPermissions | None = None
    announcement: SystemAnnouncement | None = None
    seasonal_theme: SeasonalThemeSettings | None = None
    login_panel: LoginPanel | None = None
    session_ttl_hours: int | None = Field(default=None, ge=1, le=8760)
    trash_retention_days: int | None = Field(default=None, ge=1, le=3650)
    public_shares_enabled: bool | None = None

    @field_validator("site_name")
    @classmethod
    def _non_blank_site_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("theme_color")
    @classmethod
    def _validate_theme_color(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("default_font")
    @classmethod
    def _validate_default_font(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip().lower()
        return stripped or None

    @field_validator("logo_icon")
    @classmethod
    def _validate_logo_icon(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip().lower()
        return stripped or None

    @field_validator("custom_logo_url")
    @classmethod
    def _validate_custom_logo_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("allowed_attachment_types")
    @classmethod
    def _normalise_extensions(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        seen: list[str] = []
        for raw in value:
            ext = raw.strip().lower().lstrip(".")
            if not ext:
                continue
            if ext != "*" and not ext.isalnum():
                raise ValueError(f"'{raw}' is not a valid file extension.")
            if ext not in seen:
                seen.append(ext)
        return seen
