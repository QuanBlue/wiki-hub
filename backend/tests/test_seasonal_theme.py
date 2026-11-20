"""Unit tests for Vietnamese lunar conversion and seasonal theme resolution."""

from __future__ import annotations

from datetime import date

from app.schemas.site_settings import SeasonalEventItem, SeasonalThemeSettings
from app.services.lunar_calendar import lunar_to_solar
from app.services.seasonal_theme import (
    build_home_calendar,
    default_seasonal_events,
    find_upcoming_reminders,
    resolve_active_seasonal_theme,
)


def test_vietnamese_lunar_to_solar_known_holidays() -> None:
    # Tết Nguyên Đán (1/1 Âm lịch)
    assert lunar_to_solar(2025, 1, 1) == date(2025, 1, 29)
    assert lunar_to_solar(2026, 1, 1) == date(2026, 2, 17)
    assert lunar_to_solar(2027, 1, 1) == date(2027, 2, 6)
    assert lunar_to_solar(2028, 1, 1) == date(2028, 1, 26)

    # Giỗ Tổ Hùng Vương (10/3 Âm lịch)
    assert lunar_to_solar(2025, 3, 10) == date(2025, 4, 7)
    assert lunar_to_solar(2026, 3, 10) == date(2026, 4, 26)
    assert lunar_to_solar(2027, 3, 10) == date(2027, 4, 16)

    # Tết Trung Thu (15/8 Âm lịch)
    assert lunar_to_solar(2025, 8, 15) == date(2025, 10, 6)
    assert lunar_to_solar(2026, 8, 15) == date(2026, 9, 25)
    assert lunar_to_solar(2027, 8, 15) == date(2027, 9, 15)


def test_default_events_count_and_required_ids() -> None:
    events = default_seasonal_events()
    ids = {e.id for e in events}
    expected = {
        "new_year",
        "lunar_new_year",
        "womens_day",
        "hung_kings",
        "reunification_day",
        "labor_day",
        "ho_chi_minh_birthday",
        "war_invalids_day",
        "national_day",
        "mid_autumn",
        "vietnamese_womens_day",
        "halloween",
        "mens_day",
        "peoples_army_day",
        "christmas",
    }
    # Original built-ins stay, and the extended calendar adds more on top.
    assert expected <= ids
    assert {
        "valentine", "easter", "mothers_day", "fathers_day", "thanksgiving",
        "vesak", "vu_lan", "kitchen_gods", "teachers_day", "childrens_day",
    } <= ids
    assert len(ids) == len(events)


def test_resolve_active_modes_and_year_wrap() -> None:
    cfg = SeasonalThemeSettings()

    # Off mode
    off = resolve_active_seasonal_theme(cfg.model_copy(update={"mode": "off"}), date(2026, 12, 25))
    assert off.preset == "none"
    assert off.source == "off"

    # Manual mode
    manual = resolve_active_seasonal_theme(
        cfg.model_copy(update={"mode": "manual", "manual_preset": "christmas"}),
        date(2026, 6, 10),
    )
    assert manual.preset == "christmas"
    assert manual.source == "manual"

    # Auto mode: Christmas (Dec 25) vs Army Day (Dec 22) do not overlap
    army = resolve_active_seasonal_theme(cfg, date(2026, 12, 22))
    assert army.event_id == "peoples_army_day"
    assert army.preset == "national_red_gold"

    xmas = resolve_active_seasonal_theme(cfg, date(2026, 12, 25))
    assert xmas.event_id == "christmas"
    assert xmas.preset == "christmas"

    # Auto mode: New Year cross-year wrap (Dec 30 and Jan 1)
    assert resolve_active_seasonal_theme(cfg, date(2026, 12, 30)).event_id == "new_year"
    assert resolve_active_seasonal_theme(cfg, date(2027, 1, 1)).event_id == "new_year"

    # Auto mode: Lunar New Year 2027 (1/1 ÂL = 2027-02-06, starts 25/12 ÂL = 2027-02-01)
    assert resolve_active_seasonal_theme(cfg, date(2027, 2, 2)).event_id == "lunar_new_year"
    assert resolve_active_seasonal_theme(cfg, date(2027, 2, 6)).preset == "lunar_new_year"

    # Auto mode: Memorial Day (27/07) uses solemn memorial_candle preset
    memorial = resolve_active_seasonal_theme(cfg, date(2026, 7, 27))
    assert memorial.event_id == "war_invalids_day"
    assert memorial.preset == "memorial_candle"

    # Auto mode: Men's Day (19/11)
    mens = resolve_active_seasonal_theme(cfg, date(2026, 11, 19))
    assert mens.event_id == "mens_day"
    assert mens.preset == "blue_neon"


def test_find_upcoming_reminders_within_window() -> None:
    cfg = SeasonalThemeSettings(reminder_enabled=True, reminder_days_before=7)
    # Dec 16 -> Peoples Army Day starts Dec 21 (5 days) and Christmas starts Dec 23 (7 days)
    reminders = find_upcoming_reminders(cfg, date(2026, 12, 16))
    ids = [r.event_id for r in reminders]
    assert "peoples_army_day" in ids
    assert "christmas" in ids
    assert reminders[0].days_until <= reminders[-1].days_until

    # Disabled reminders return empty
    assert find_upcoming_reminders(cfg.model_copy(update={"reminder_enabled": False}), date(2026, 12, 16)) == []


def test_build_home_calendar_orders_active_first_then_chronological() -> None:
    cfg = SeasonalThemeSettings()
    # On 2026-11-19 (International Men's Day), mens_day should be first with is_today=True
    entries = build_home_calendar(cfg, date(2026, 11, 19))
    assert len(entries) == len(default_seasonal_events())
    assert entries[0].event_id == "mens_day"
    assert entries[0].is_today is True
    assert entries[0].is_active is True

    # Next upcoming should be Peoples Army Day (22/12/2026) and Christmas (25/12/2026)
    upcoming_ids = [e.event_id for e in entries[1:5]]
    assert upcoming_ids == ["teachers_day", "thanksgiving", "peoples_army_day", "christmas"]

    # Custom event shows up on calendar too
    custom = SeasonalEventItem(
        id="company_anniversary",
        builtin=False,
        name_en="Company Anniversary",
        name_vi="Sinh nhật công ty",
        preset="new_year",
        calendar_type="solar",
        event_month=11,
        event_day=25,
        start_month=11,
        start_day=24,
        end_month=11,
        end_day=26,
    )
    cfg_custom = cfg.model_copy(update={"events": [*cfg.events, custom]})
    entries_custom = build_home_calendar(cfg_custom, date(2026, 11, 19))
    custom_entry = next(e for e in entries_custom if e.event_id == "company_anniversary")
    assert custom_entry.days_until == 6


def test_computed_holidays_easter_and_nth_weekday() -> None:
    from app.services.seasonal_theme import _easter_sunday, _nth_weekday

    assert _easter_sunday(2025) == date(2025, 4, 20)
    assert _easter_sunday(2026) == date(2026, 4, 5)
    assert _easter_sunday(2027) == date(2027, 3, 28)
    # Mother's Day (2nd Sunday of May), Father's Day (3rd Sunday of June)
    assert _nth_weekday(2026, 5, 6, 2) == date(2026, 5, 10)
    assert _nth_weekday(2026, 6, 6, 3) == date(2026, 6, 21)
    # Thanksgiving (4th Thursday of November), last Monday of May
    assert _nth_weekday(2026, 11, 3, 4) == date(2026, 11, 26)
    assert _nth_weekday(2026, 5, 0, -1) == date(2026, 5, 25)

    cfg = SeasonalThemeSettings()
    assert resolve_active_seasonal_theme(cfg, date(2026, 11, 26)).event_id == "thanksgiving"
    assert resolve_active_seasonal_theme(cfg, date(2026, 4, 5)).event_id == "easter"
    assert resolve_active_seasonal_theme(cfg, date(2026, 5, 10)).event_id == "mothers_day"
    assert resolve_active_seasonal_theme(cfg, date(2025, 2, 14)).event_id == "valentine"


def test_merge_builtin_events_adds_missing_without_touching_existing() -> None:
    from app.services.seasonal_theme import merge_builtin_events

    defaults = default_seasonal_events()
    old = [e for e in defaults if e.id in {"new_year", "christmas"}]
    edited = old[0].model_copy(update={"enabled": False})
    merged = merge_builtin_events([edited, old[1]])
    assert merged[0].enabled is False
    assert {e.id for e in merged} == {e.id for e in defaults}
    assert len(merged) == len(defaults)


def test_merge_builtin_events_moves_teachers_day_off_the_old_default_preset() -> None:
    from app.services.seasonal_theme import merge_builtin_events

    stock = next(e for e in default_seasonal_events() if e.id == "teachers_day")
    assert stock.preset == "teachers_day"

    stored = stock.model_copy(update={"preset": "floral_pink"})
    merged = {e.id: e for e in merge_builtin_events([stored])}
    assert merged["teachers_day"].preset == "teachers_day"

    # A preset the administrator chose on purpose is never overwritten.
    chosen = stock.model_copy(update={"preset": "kids_party"})
    assert {e.id: e for e in merge_builtin_events([chosen])}["teachers_day"].preset == "kids_party"
