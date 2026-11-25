"""Seasonal / holiday theme resolution, upcoming reminders, and Home calendar.

Resolves both Solar (Gregorian) and Vietnamese Lunar (UTC+7) recurring holidays,
including year-boundary wrap-around windows such as New Year (Dec 29 -> Jan 2)
and Lunar New Year (Lunar Dec 25 -> Lunar Jan 7).
"""

from __future__ import annotations

import calendar
from datetime import UTC, date, datetime, timedelta, timezone

from app.schemas.site_settings import (
    ActiveSeasonalTheme,
    SeasonalCalendarEntry,
    SeasonalEventItem,
    SeasonalThemeSettings,
    UpcomingSeasonalReminder,
)
from app.services.lunar_calendar import lunar_to_solar

VN_TZ = timezone(timedelta(hours=7))


def _today_vn(now: datetime | date | None = None) -> date:
    if now is None:
        return datetime.now(VN_TZ).date()
    if isinstance(now, datetime):
        if now.tzinfo is None:
            now = now.replace(tzinfo=UTC)
        return now.astimezone(VN_TZ).date()
    return now


def _safe_solar_date(year: int, month: int, day: int) -> date:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last_day))


def _easter_sunday(year: int) -> date:
    """Western (Gregorian) Easter Sunday - anonymous Gregorian algorithm."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    el = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * el) // 451
    month, day = divmod(h + el - 7 * m + 114, 31)
    return date(year, month, day + 1)


def _nth_weekday(year: int, month: int, weekday: int, nth: int) -> date:
    """``nth`` (1-5) or last (``-1``) ``weekday`` (0 = Monday) of a month."""
    if nth > 0:
        first = date(year, month, 1)
        day = 1 + (weekday - first.weekday()) % 7 + 7 * (nth - 1)
        return _safe_solar_date(year, month, day)
    last_day = calendar.monthrange(year, month)[1]
    last = date(year, month, last_day)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _computed_event_date(event: SeasonalEventItem, year: int) -> date:
    if event.calendar_type == "easter":
        return _easter_sunday(year)
    return _nth_weekday(year, event.event_month, event.weekday, event.week_of_month)


def _resolve_occurrence(
    event: SeasonalEventItem, anchor_year: int
) -> tuple[date, date, date]:
    """Return ``(event_date, starts_on, ends_on)`` for ``anchor_year``.

    For a wrap-around window (e.g. ``start=(12, 29)`` -> ``end=(1, 2)`` with
    ``event=(1, 1)``), ``anchor_year`` is the year of ``event_date`` (e.g. 2027),
    so ``starts_on`` falls in ``anchor_year - 1`` (Dec 29, 2026) and ``ends_on``
    in ``anchor_year`` (Jan 2, 2027).
    """
    if event.calendar_type in ("easter", "weekday"):
        ev_date = _computed_event_date(event, anchor_year)
        return (
            ev_date,
            ev_date - timedelta(days=event.window_before),
            ev_date + timedelta(days=event.window_after),
        )

    wraps = (event.start_month, event.start_day) > (event.end_month, event.end_day)
    if event.calendar_type == "lunar":
        ev_date = lunar_to_solar(anchor_year, event.event_month, event.event_day)
        if wraps:
            if (event.event_month, event.event_day) <= (event.end_month, event.end_day):
                start_year = anchor_year - 1
                end_year = anchor_year
            else:
                start_year = anchor_year
                end_year = anchor_year + 1
        else:
            start_year = anchor_year
            end_year = anchor_year
        starts_on = lunar_to_solar(start_year, event.start_month, event.start_day)
        ends_on = lunar_to_solar(end_year, event.end_month, event.end_day)
        return ev_date, starts_on, ends_on

    ev_date = _safe_solar_date(anchor_year, event.event_month, event.event_day)
    if wraps:
        if (event.event_month, event.event_day) <= (event.end_month, event.end_day):
            start_year = anchor_year - 1
            end_year = anchor_year
        else:
            start_year = anchor_year
            end_year = anchor_year + 1
    else:
        start_year = anchor_year
        end_year = anchor_year
    starts_on = _safe_solar_date(start_year, event.start_month, event.start_day)
    ends_on = _safe_solar_date(end_year, event.end_month, event.end_day)
    return ev_date, starts_on, ends_on


def _core_seasonal_events() -> list[SeasonalEventItem]:
    return [
        SeasonalEventItem(
            id="new_year",
            builtin=True,
            name_en="New Year's Day",
            name_vi="Tết Dương lịch",
            preset="new_year",
            calendar_type="solar",
            event_month=1,
            event_day=1,
            start_month=12,
            start_day=29,
            end_month=1,
            end_day=2,
            is_public_holiday=True,
            holiday_days=1,
            holiday_note_en="1 day off (Jan 1)",
            holiday_note_vi="Nghỉ 1 ngày (01/01)",
        ),
        SeasonalEventItem(
            id="lunar_new_year",
            builtin=True,
            name_en="Lunar New Year (Tết)",
            name_vi="Tết Nguyên Đán",
            preset="lunar_new_year",
            calendar_type="lunar",
            event_month=1,
            event_day=1,
            start_month=12,
            start_day=25,
            end_month=1,
            end_day=7,
            is_public_holiday=True,
            holiday_days=5,
            holiday_note_en="5 official days off (late 12th – early 1st lunar month)",
            holiday_note_vi="Nghỉ 5 ngày theo quy định (cuối tháng Chạp – đầu tháng Giêng ÂL)",
        ),
        SeasonalEventItem(
            id="womens_day",
            builtin=True,
            name_en="International Women's Day",
            name_vi="Ngày Quốc tế Phụ nữ",
            preset="floral_pink",
            calendar_type="solar",
            event_month=3,
            event_day=8,
            start_month=3,
            start_day=7,
            end_month=3,
            end_day=8,
            is_public_holiday=False,
            holiday_days=0,
        ),
        SeasonalEventItem(
            id="hung_kings",
            builtin=True,
            name_en="Hung Kings' Commemoration Day",
            name_vi="Giỗ Tổ Hùng Vương",
            preset="heritage_gold",
            calendar_type="lunar",
            event_month=3,
            event_day=10,
            start_month=3,
            start_day=9,
            end_month=3,
            end_day=10,
            is_public_holiday=True,
            holiday_days=1,
            holiday_note_en="1 day off (10th day of 3rd lunar month)",
            holiday_note_vi="Nghỉ 1 ngày (10/03 Âm lịch)",
        ),
        SeasonalEventItem(
            id="reunification_day",
            builtin=True,
            name_en="Reunification Day",
            name_vi="Ngày Giải phóng miền Nam, thống nhất đất nước",
            preset="national_red_gold",
            calendar_type="solar",
            event_month=4,
            event_day=30,
            start_month=4,
            start_day=29,
            end_month=4,
            end_day=30,
            is_public_holiday=True,
            holiday_days=1,
            holiday_note_en="1 day off (Apr 30)",
            holiday_note_vi="Nghỉ 1 ngày (30/04)",
        ),
        SeasonalEventItem(
            id="labor_day",
            builtin=True,
            name_en="International Workers' Day",
            name_vi="Ngày Quốc tế Lao động",
            preset="national_red_gold",
            calendar_type="solar",
            event_month=5,
            event_day=1,
            start_month=5,
            start_day=1,
            end_month=5,
            end_day=2,
            is_public_holiday=True,
            holiday_days=1,
            holiday_note_en="1 day off (May 1)",
            holiday_note_vi="Nghỉ 1 ngày (01/05)",
        ),
        SeasonalEventItem(
            id="ho_chi_minh_birthday",
            builtin=True,
            name_en="President Ho Chi Minh's Birthday",
            name_vi="Ngày sinh Chủ tịch Hồ Chí Minh",
            preset="lotus_gold",
            calendar_type="solar",
            event_month=5,
            event_day=19,
            start_month=5,
            start_day=18,
            end_month=5,
            end_day=19,
            is_public_holiday=False,
            holiday_days=0,
        ),
        SeasonalEventItem(
            id="war_invalids_day",
            builtin=True,
            name_en="War Invalids and Martyrs' Day",
            name_vi="Ngày Thương binh - Liệt sĩ",
            preset="memorial_candle",
            calendar_type="solar",
            event_month=7,
            event_day=27,
            start_month=7,
            start_day=27,
            end_month=7,
            end_day=27,
            is_public_holiday=False,
            holiday_days=0,
        ),
        SeasonalEventItem(
            id="national_day",
            builtin=True,
            name_en="Vietnam National Day",
            name_vi="Ngày Quốc khánh",
            preset="national_red_gold",
            calendar_type="solar",
            event_month=9,
            event_day=2,
            start_month=9,
            start_day=1,
            end_month=9,
            end_day=3,
            is_public_holiday=True,
            holiday_days=2,
            holiday_note_en="2 days off (Sep 2 and 1 adjacent day)",
            holiday_note_vi="Nghỉ 2 ngày (02/09 và 1 ngày liền kề trước hoặc sau)",
        ),
        SeasonalEventItem(
            id="mid_autumn",
            builtin=True,
            name_en="Mid-Autumn Festival",
            name_vi="Tết Trung Thu",
            preset="mid_autumn",
            calendar_type="lunar",
            event_month=8,
            event_day=15,
            start_month=8,
            start_day=12,
            end_month=8,
            end_day=16,
            is_public_holiday=False,
            holiday_days=0,
        ),
        SeasonalEventItem(
            id="vietnamese_womens_day",
            builtin=True,
            name_en="Vietnamese Women's Day",
            name_vi="Ngày Phụ nữ Việt Nam",
            preset="floral_pink",
            calendar_type="solar",
            event_month=10,
            event_day=20,
            start_month=10,
            start_day=19,
            end_month=10,
            end_day=20,
            is_public_holiday=False,
            holiday_days=0,
        ),
        SeasonalEventItem(
            id="halloween",
            builtin=True,
            name_en="Halloween",
            name_vi="Halloween",
            preset="halloween",
            calendar_type="solar",
            event_month=10,
            event_day=31,
            start_month=10,
            start_day=28,
            end_month=11,
            end_day=1,
            is_public_holiday=False,
            holiday_days=0,
        ),
        SeasonalEventItem(
            id="mens_day",
            builtin=True,
            name_en="International Men's Day",
            name_vi="Ngày Quốc tế Nam giới",
            preset="blue_neon",
            calendar_type="solar",
            event_month=11,
            event_day=19,
            start_month=11,
            start_day=19,
            end_month=11,
            end_day=19,
            is_public_holiday=False,
            holiday_days=0,
        ),
        SeasonalEventItem(
            id="peoples_army_day",
            builtin=True,
            name_en="Vietnam People's Army Foundation Day",
            name_vi="Ngày thành lập Quân đội Nhân dân Việt Nam",
            preset="national_red_gold",
            calendar_type="solar",
            event_month=12,
            event_day=22,
            start_month=12,
            start_day=21,
            end_month=12,
            end_day=22,
            is_public_holiday=False,
            holiday_days=0,
        ),
        SeasonalEventItem(
            id="christmas",
            builtin=True,
            name_en="Christmas",
            name_vi="Giáng sinh",
            preset="christmas",
            calendar_type="solar",
            event_month=12,
            event_day=25,
            start_month=12,
            start_day=23,
            end_month=12,
            end_day=26,
            is_public_holiday=False,
            holiday_days=0,
        ),
    ]


def _ev(
    id: str,
    name_vi: str,
    name_en: str,
    preset: str,
    calendar_type: str,
    month: int,
    day: int,
    *,
    start: tuple[int, int] | None = None,
    end: tuple[int, int] | None = None,
    **extra: object,
) -> SeasonalEventItem:
    sm, sd = start or (month, day)
    em, ed = end or (month, day)
    return SeasonalEventItem(
        id=id,
        builtin=True,
        name_en=name_en,
        name_vi=name_vi,
        preset=preset,  # type: ignore[arg-type]
        calendar_type=calendar_type,  # type: ignore[arg-type]
        event_month=month,
        event_day=day,
        start_month=sm,
        start_day=sd,
        end_month=em,
        end_day=ed,
        **extra,  # type: ignore[arg-type]
    )


#: Additional built-in events, inserted right after the anchor event id so the
#: list stays roughly chronological (list order = priority when windows overlap).
_EXTRA_EVENTS: list[tuple[str, SeasonalEventItem]] = [
    ("lunar_new_year", _ev("lantern_festival", "Rằm tháng Giêng (Tết Nguyên tiêu)", "Lantern Festival (Nguyên Tiêu)", "mid_autumn", "lunar", 1, 15, start=(1, 14))),
    ("lunar_new_year", _ev("party_founding", "Ngày thành lập Đảng Cộng sản Việt Nam", "Founding of the Communist Party of Vietnam", "national_red_gold", "solar", 2, 3)),
    ("lunar_new_year", _ev("valentine", "Ngày Valentine", "Valentine's Day", "valentine", "solar", 2, 14, start=(2, 13))),
    ("lunar_new_year", _ev("doctors_day", "Ngày Thầy thuốc Việt Nam", "Vietnamese Doctors' Day", "blue_neon", "solar", 2, 27)),
    ("womens_day", _ev("han_thuc", "Tết Hàn thực", "Cold Food Festival (Hàn Thực)", "heritage_gold", "lunar", 3, 3, start=(3, 2))),
    ("womens_day", _ev("st_patrick", "Ngày Thánh Patrick", "St. Patrick's Day", "spring_green", "solar", 3, 17, start=(3, 16))),
    ("womens_day", _ev("youth_union_day", "Ngày thành lập Đoàn TNCS Hồ Chí Minh", "Ho Chi Minh Communist Youth Union Day", "blue_neon", "solar", 3, 26)),
    ("hung_kings", _ev("easter", "Lễ Phục sinh", "Easter", "easter", "easter", 4, 1, window_before=2, window_after=1)),
    ("hung_kings", _ev("book_day", "Ngày Sách và Văn hóa đọc Việt Nam", "Vietnam Book and Reading Culture Day", "heritage_gold", "solar", 4, 21)),
    ("hung_kings", _ev("earth_day", "Ngày Trái Đất", "Earth Day", "spring_green", "solar", 4, 22)),
    ("labor_day", _ev("mothers_day", "Ngày của Mẹ", "Mother's Day", "floral_pink", "weekday", 5, 1, weekday=6, week_of_month=2, window_before=2, window_after=0)),
    ("ho_chi_minh_birthday", _ev("vesak", "Lễ Phật Đản", "Vesak (Buddha's Birthday)", "lotus_gold", "lunar", 4, 15, start=(4, 14))),
    ("ho_chi_minh_birthday", _ev("dragon_boat", "Tết Đoan Ngọ", "Dragon Boat Festival (Đoan Ngọ)", "heritage_gold", "lunar", 5, 5, start=(5, 4))),
    ("ho_chi_minh_birthday", _ev("childrens_day", "Ngày Quốc tế Thiếu nhi", "International Children's Day", "kids_party", "solar", 6, 1, start=(5, 31))),
    ("ho_chi_minh_birthday", _ev("press_day", "Ngày Báo chí Cách mạng Việt Nam", "Vietnam Revolutionary Press Day", "blue_neon", "solar", 6, 21)),
    ("ho_chi_minh_birthday", _ev("family_day", "Ngày Gia đình Việt Nam", "Vietnamese Family Day", "floral_pink", "solar", 6, 28)),
    ("ho_chi_minh_birthday", _ev("fathers_day", "Ngày của Cha", "Father's Day", "blue_neon", "weekday", 6, 1, weekday=6, week_of_month=3, window_before=2, window_after=0)),
    ("war_invalids_day", _ev("vu_lan", "Lễ Vu Lan báo hiếu", "Vu Lan (Filial Piety Festival)", "lotus_gold", "lunar", 7, 15, start=(7, 14))),
    ("war_invalids_day", _ev("august_revolution", "Ngày Cách mạng tháng Tám thành công", "August Revolution Day", "national_red_gold", "solar", 8, 19)),
    ("mid_autumn", _ev("entrepreneurs_day", "Ngày Doanh nhân Việt Nam", "Vietnam Entrepreneurs' Day", "blue_neon", "solar", 10, 13)),
    ("mens_day", _ev("teachers_day", "Ngày Nhà giáo Việt Nam", "Vietnamese Teachers' Day", "teachers_day", "solar", 11, 20)),
    ("mens_day", _ev("thanksgiving", "Lễ Tạ ơn", "Thanksgiving", "autumn_harvest", "weekday", 11, 1, weekday=3, week_of_month=4, window_before=2, window_after=0)),
    ("peoples_army_day", _ev("kitchen_gods", "Ông Công, Ông Táo", "Kitchen Gods' Day (Ông Táo)", "lunar_new_year", "lunar", 12, 23, start=(12, 22))),
]


def default_seasonal_events() -> list[SeasonalEventItem]:
    """Built-in Vietnamese & major international holiday calendar."""
    result: list[SeasonalEventItem] = []
    for core in _core_seasonal_events():
        result.append(core)
        result.extend(ev for anchor, ev in _EXTRA_EVENTS if anchor == core.id)
    return result


#: Built-in events whose default preset was replaced by a dedicated one:
#: ``(event id, old default preset) -> new preset``. Only an event still on the
#: old default is moved, so a preset an administrator picked deliberately
#: (anything else) is left alone.
_PRESET_UPGRADES: dict[tuple[str, str], str] = {
    ("teachers_day", "floral_pink"): "teachers_day",
}


def merge_builtin_events(
    events: list[SeasonalEventItem],
) -> list[SeasonalEventItem]:
    """Bring a stored list up to date with the built-in calendar (older installs).

    Missing built-in events are appended, and a built-in event still on a
    superseded default preset moves to its new one. Everything else,
    including administrator edits, is kept as stored.
    """
    upgraded = [
        ev.model_copy(update={"preset": _PRESET_UPGRADES[(ev.id, ev.preset)]})
        if ev.builtin and (ev.id, ev.preset) in _PRESET_UPGRADES
        else ev
        for ev in events
    ]
    present = {event.id for event in upgraded}
    missing = [ev for ev in default_seasonal_events() if ev.id not in present]
    return [*upgraded, *missing]


def _candidate_years(today: date) -> tuple[int, int, int]:
    return (today.year - 1, today.year, today.year + 1)


def resolve_active_seasonal_theme(
    config: SeasonalThemeSettings | None = None, now: datetime | date | None = None
) -> ActiveSeasonalTheme:
    """Resolve which seasonal preset should be rendered right now."""
    if config is None or config.mode == "off":
        return ActiveSeasonalTheme(preset="none", source="off")

    if config.mode == "manual":
        return ActiveSeasonalTheme(
            preset=config.manual_preset,
            source="manual",
        )

    today = _today_vn(now)
    for event in config.events:
        if not event.enabled or not event.auto_activate or event.preset == "none":
            continue
        for year in _candidate_years(today):
            _ev_date, starts_on, ends_on = _resolve_occurrence(event, year)
            if starts_on <= today <= ends_on:
                return ActiveSeasonalTheme(
                    preset=event.preset,
                    event_id=event.id,
                    event_name_en=event.name_en,
                    event_name_vi=event.name_vi,
                    source="auto",
                )

    return ActiveSeasonalTheme(preset="none", source="auto")


def find_upcoming_reminders(
    config: SeasonalThemeSettings, now: datetime | date | None = None
) -> list[UpcomingSeasonalReminder]:
    """Return enabled events starting within ``1..reminder_days_before`` days."""
    if not config.reminder_enabled:
        return []

    today = _today_vn(now)
    max_days = config.reminder_days_before
    upcoming: list[UpcomingSeasonalReminder] = []

    for event in config.events:
        if not event.enabled or event.preset == "none":
            continue
        for year in _candidate_years(today):
            ev_date, starts_on, ends_on = _resolve_occurrence(event, year)
            days_until = (starts_on - today).days
            if 1 <= days_until <= max_days:
                upcoming.append(
                    UpcomingSeasonalReminder(
                        event_id=event.id,
                        occurrence_key=f"{event.id}:{ev_date.year}",
                        name_en=event.name_en,
                        name_vi=event.name_vi,
                        preset=event.preset,
                        event_date=ev_date,
                        starts_on=starts_on,
                        ends_on=ends_on,
                        days_until=days_until,
                        auto_activate=event.auto_activate,
                    )
                )
                break

    upcoming.sort(key=lambda item: (item.days_until, item.starts_on, item.event_id))
    return upcoming


def build_home_calendar(
    config: SeasonalThemeSettings, now: datetime | date | None = None
) -> list[SeasonalCalendarEntry]:
    """Build the next 12 months' holiday calendar for the Home page widget.

    Events currently active or occurring today come first, followed by upcoming
    events in chronological order.
    """
    today = _today_vn(now)
    entries: list[SeasonalCalendarEntry] = []

    for event in config.events:
        if not event.enabled or not event.show_on_home_calendar:
            continue

        chosen: tuple[date, date, date] | None = None
        for year in _candidate_years(today):
            ev_date, starts_on, ends_on = _resolve_occurrence(event, year)
            # Keep an occurrence if it is still active or its main date is today/future.
            if ends_on >= today or ev_date >= today:
                chosen = (ev_date, starts_on, ends_on)
                break

        if chosen is None:
            continue

        ev_date, starts_on, ends_on = chosen
        is_active = starts_on <= today <= ends_on
        is_today = ev_date == today
        days_until = max(0, (ev_date - today).days)
        lunar_label = (
            f"{event.event_day:02d}/{event.event_month:02d} ÂL"
            if event.calendar_type == "lunar"
            else None
        )

        entries.append(
            SeasonalCalendarEntry(
                event_id=event.id,
                name_en=event.name_en,
                name_vi=event.name_vi,
                preset=event.preset,
                calendar_type=event.calendar_type,
                lunar_label=lunar_label,
                event_date=ev_date,
                starts_on=starts_on,
                ends_on=ends_on,
                days_until=days_until,
                is_active=is_active,
                is_today=is_today,
                is_public_holiday=event.is_public_holiday,
                holiday_days=event.holiday_days,
                holiday_note_en=event.holiday_note_en,
                holiday_note_vi=event.holiday_note_vi,
            )
        )

    entries.sort(key=lambda item: (not item.is_today, not item.is_active, item.event_date, item.event_id))
    return entries


async def dispatch_upcoming_seasonal_reminders(
    session, *, now: datetime | None = None
) -> dict[str, int]:
    """Send in-app bell notifications (and optional SMTP emails) for upcoming events.

    Idempotent: each ``<event_id>:<year>`` occurrence is recorded in
    ``site_settings.seasonal_theme.notified_occurrences`` after dispatch so it
    fires at most once per year.
    """
    from sqlalchemy import select

    from app.core.logging import get_logger
    from app.models.site_settings import SINGLETON_ID, SiteSettings
    from app.modules.admin_mail import crypto as mail_crypto
    from app.modules.admin_mail import smtp as mail_smtp
    from app.modules.admin_mail.service import AdminMailService
    from app.modules.notifications.service import notify
    from app.services.site_settings import SiteSettingsService

    log = get_logger(__name__)
    current_dt = now or datetime.now(UTC)

    settings_svc = SiteSettingsService(session)
    effective = await settings_svc.get_effective()
    config = effective.seasonal_theme

    upcoming = find_upcoming_reminders(config, current_dt)
    pending = [
        item for item in upcoming if item.occurrence_key not in config.notified_occurrences
    ]
    if not pending:
        return {"events": 0, "notifications": 0, "emails": 0}

    mail_service = AdminMailService(session)
    admins = await mail_service._system_administrators()
    mailboxes = await mail_service.repo.active_mailboxes() if config.reminder_send_email else []

    notif_count = 0
    email_count = 0
    notified = dict(config.notified_occurrences)

    for reminder in pending:
        for admin in admins:
            await notify(
                session,
                admin.id,
                "seasonal_theme_upcoming",
                params={
                    "name_en": reminder.name_en,
                    "name_vi": reminder.name_vi,
                    "days": str(reminder.days_until),
                    "starts_on": reminder.starts_on.strftime("%d/%m/%Y"),
                },
                link="/admin/settings?tab=seasonal",
            )
            notif_count += 1

        if config.reminder_send_email and mailboxes:
            site_name = effective.site_name or "WikiHub"
            subject = (
                f"[{site_name}] Sắp tới {reminder.name_vi} ({reminder.name_en}) "
                f"- còn {reminder.days_until} ngày"
            )
            auto_line_vi = (
                f"Hiệu ứng sẽ tự động kích hoạt vào ngày {reminder.starts_on.strftime('%d/%m/%Y')}."
                if reminder.auto_activate and config.mode == "auto"
                else "Bạn có thể vào mục Quản trị > Cài đặt > Hiệu ứng lễ hội để bật thủ công."
            )
            auto_line_en = (
                f"The seasonal effect will auto-activate on {reminder.starts_on.strftime('%Y-%m-%d')}."
                if reminder.auto_activate and config.mode == "auto"
                else "You can open Administration > Settings > Seasonal Effects to enable it."
            )
            body = (
                f"{site_name} — Nhắc nhở sự kiện sắp tới / Upcoming holiday reminder\n\n"
                f"• Sự kiện / Event: {reminder.name_vi} ({reminder.name_en})\n"
                f"• Ngày chính / Date: {reminder.event_date.strftime('%d/%m/%Y')}\n"
                f"• Khung hiệu ứng / Window: {reminder.starts_on.strftime('%d/%m/%Y')} – {reminder.ends_on.strftime('%d/%m/%Y')}\n"
                f"• Còn lại / Starts in: {reminder.days_until} ngày / day(s)\n\n"
                f"{auto_line_vi}\n{auto_line_en}\n"
            )
            for mailbox in mailboxes:
                try:
                    password = mail_crypto.decrypt(mailbox.smtp_password_enc)
                    smtp_cfg = mail_smtp.SmtpConfig(
                        host=mailbox.smtp_host,
                        port=mailbox.smtp_port,
                        security=mailbox.smtp_security,
                        username=mailbox.smtp_username,
                        password=password,
                        email=mailbox.email,
                        display_name=mailbox.display_name or site_name,
                    )
                    outcome = await mail_smtp.send(
                        smtp_cfg,
                        subject=subject,
                        body=body,
                        timeout_seconds=15.0,
                    )
                    if outcome.ok:
                        email_count += 1
                    else:
                        log.warning(
                            "seasonal_reminder_email_failed",
                            mailbox=mailbox.email,
                            error=outcome.error,
                        )
                except Exception as exc:  # noqa: BLE001
                    log.warning(
                        "seasonal_reminder_email_error",
                        mailbox=mailbox.email,
                        error=str(exc)[:200],
                    )

        notified[reminder.occurrence_key] = current_dt.isoformat()

    row = (
        await session.execute(select(SiteSettings).where(SiteSettings.id == SINGLETON_ID))
    ).scalar_one_or_none()
    if row is None:
        row = SiteSettings(id=SINGLETON_ID)
        session.add(row)
        await session.flush()

    updated_config = config.model_copy(update={"notified_occurrences": notified})
    row.seasonal_theme = updated_config.model_dump(mode="json")
    await session.flush()

    return {"events": len(pending), "notifications": notif_count, "emails": email_count}

