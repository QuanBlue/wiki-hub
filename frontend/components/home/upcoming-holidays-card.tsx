"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Settings2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  HOLIDAY_DETAILS,
  HolidayThumbnail,
} from "@/components/seasonal/holiday-details";
import { getSeasonalPresetMeta } from "@/components/seasonal/seasonal-presets";
import { useThemeSettings } from "@/components/theme-color-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  SeasonalCalendarEntry,
  SiteSettings,
  UpcomingSeasonalReminder,
} from "@/types/api";

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function toIsoKey(year: number, monthIndex: number, day: number): string {
  const mm = String(monthIndex + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function formatMonthYear(year: number, monthIndex: number, locale: string): string {
  if (locale === "vi") {
    return `Tháng ${monthIndex + 1}, ${year}`;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(new Date(year, monthIndex, 1));
}

function formatShortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parseIsoDate(iso));
}

function formatDayMonth(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(parseIsoDate(iso));
}

function formatFullDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parseIsoDate(iso));
}

function buildMonthCells(
  year: number,
  monthIndex: number,
  padToSixRows = false,
) {
  const firstDayOfMonth = new Date(year, monthIndex, 1);
  const leadingBlanks = (firstDayOfMonth.getDay() + 6) % 7; // Mon = 0 .. Sun = 6
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<{ day: number | null; col: number; row: number }> = [];
  for (let i = 0; i < leadingBlanks; i++) {
    cells.push({ day: null, col: i % 7, row: Math.floor(i / 7) });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const idx = leadingBlanks + d - 1;
    cells.push({ day: d, col: idx % 7, row: Math.floor(idx / 7) });
  }
  if (padToSixRows) {
    while (cells.length < 42) {
      const idx = cells.length;
      cells.push({ day: null, col: idx % 7, row: Math.floor(idx / 7) });
    }
  }
  return cells;
}

const WEEKDAYS_VI = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const WEEKDAYS_EN = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * Compact monthly calendar grid widget for the Home right rail +
 * unified two-column Calendar Detail modal (Left: interactive month grid,
 * Right: full details for the selected holiday/date).
 */
export function UpcomingHolidaysCard({
  entries,
  isAdmin = false,
}: {
  entries: SeasonalCalendarEntry[];
  isAdmin?: boolean;
}) {
  const { locale, t } = useTranslation();
  const today = useMemo(() => new Date(), []);
  const todayKey = toIsoKey(today.getFullYear(), today.getMonth(), today.getDate());

  // Mini-calendar state (Home right rail)
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const closeHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Two-column Detail Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalYear, setModalYear] = useState(today.getFullYear());
  const [modalMonth, setModalMonth] = useState(today.getMonth());
  const [selectedDateKey, setSelectedDateKey] = useState<string>(todayKey);

  // Index events by YYYY-MM-DD and MM-DD (for solar recurring fallback)
  const eventsIndex = useMemo(() => {
    const exact = new Map<string, SeasonalCalendarEntry[]>();
    const solarByMonthDay = new Map<string, SeasonalCalendarEntry[]>();
    for (const item of entries) {
      const list = exact.get(item.event_date) ?? [];
      list.push(item);
      exact.set(item.event_date, list);
      if (item.calendar_type === "solar") {
        const md = item.event_date.slice(5);
        const mdList = solarByMonthDay.get(md) ?? [];
        mdList.push(item);
        solarByMonthDay.set(md, mdList);
      }
    }
    return { exact, solarByMonthDay };
  }, [entries]);

  // Admin-only: holidays inside their reminder window, so the effect can be
  // switched on early from the calendar (this replaced a page-wide banner).
  const { seasonalTheme, setSeasonalTheme } = useThemeSettings();
  const [reminders, setReminders] = useState<UpcomingSeasonalReminder[]>([]);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void api
      .get<UpcomingSeasonalReminder[]>("/api/v1/settings/seasonal-reminders")
      .then((list) => {
        if (active && Array.isArray(list)) setReminders(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isAdmin]);

  const pendingReminders = isAdmin
    ? reminders.filter((item) => seasonalTheme.preset !== item.preset)
    : [];
  const nextReminder = pendingReminders[0] ?? null;

  function reminderFor(eventId: string): UpcomingSeasonalReminder | null {
    return pendingReminders.find((item) => item.event_id === eventId) ?? null;
  }

  async function activateReminder(reminder: UpcomingSeasonalReminder) {
    if (activating) return;
    const name = locale === "vi" ? reminder.name_vi : reminder.name_en;
    setActivating(true);
    try {
      await api.post<SiteSettings>("/api/v1/settings/seasonal-theme/activate", {
        preset: reminder.preset,
      });
      setSeasonalTheme({
        preset: reminder.preset,
        event_id: reminder.event_id,
        event_name_en: reminder.name_en,
        event_name_vi: reminder.name_vi,
        source: "manual",
      });
      toast.success(t("seasonal.banner.activatedToast", { name }));
    } catch {
      toast.error(t("seasonal.banner.activateFailed"));
    } finally {
      setActivating(false);
    }
  }

  if (!entries || entries.length === 0) return null;

  function lookupEvents(
    index: {
      exact: Map<string, SeasonalCalendarEntry[]>;
      solarByMonthDay: Map<string, SeasonalCalendarEntry[]>;
    },
    isoKey: string,
  ): SeasonalCalendarEntry[] {
    const exactMatches = index.exact.get(isoKey);
    if (exactMatches && exactMatches.length > 0) return exactMatches;
    return index.solarByMonthDay.get(isoKey.slice(5)) ?? [];
  }

  function shiftHomeMonth(delta: number) {
    setHoveredKey(null);
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function shiftModalMonth(delta: number) {
    const next = new Date(modalYear, modalMonth + delta, 1);
    setModalYear(next.getFullYear());
    setModalMonth(next.getMonth());
  }

  function openModalForDate(isoDate: string) {
    const d = parseIsoDate(isoDate);
    setModalYear(d.getFullYear());
    setModalMonth(d.getMonth());
    setSelectedDateKey(isoDate);
    setHoveredKey(null);
    setModalOpen(true);
  }

  function openHover(key: string) {
    if (closeHoverTimerRef.current) {
      clearTimeout(closeHoverTimerRef.current);
      closeHoverTimerRef.current = null;
    }
    setHoveredKey(key);
  }

  function scheduleCloseHover() {
    if (closeHoverTimerRef.current) {
      clearTimeout(closeHoverTimerRef.current);
    }
    closeHoverTimerRef.current = setTimeout(() => {
      setHoveredKey(null);
    }, 140);
  }

  const weekdays = locale === "vi" ? WEEKDAYS_VI : WEEKDAYS_EN;
  const homeCells = buildMonthCells(viewYear, viewMonth);
  const modalCells = buildMonthCells(modalYear, modalMonth, true);
  const nextUpcoming = entries[0];
  const nextFutureEvent =
    entries.find((e) => !e.is_today && e.days_until > 0) ?? entries[0];
  const nextPublicHoliday =
    entries.find((e) => e.is_public_holiday && e.days_until > 0) ??
    entries.find((e) => e.is_public_holiday) ??
    null;
  const selectedEvents = lookupEvents(eventsIndex, selectedDateKey);

  function renderCountdown(item: SeasonalCalendarEntry) {
    if (item.is_today) {
      return (
        <Badge variant="info" className="shrink-0 text-[10px]">
          {t("seasonal.calendar.today")}
        </Badge>
      );
    }
    if (item.is_active) {
      return (
        <Badge variant="success" className="shrink-0 text-[10px]">
          {t("seasonal.calendar.active")}
        </Badge>
      );
    }
    return (
      <span className="text-muted-foreground shrink-0 text-[11px] font-medium tabular-nums">
        {t("seasonal.calendar.inDays", { days: item.days_until })}
      </span>
    );
  }

  return (
    <>
      {/* Compact Home Right-Rail Month Calendar */}
      <section
        aria-label={t("seasonal.calendar.title")}
        className="border-border bg-surface rounded-lg border p-2.5"
      >
        <div className="mb-1.5 flex items-center justify-between gap-1">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => shiftHomeMonth(-1)}
              aria-label={t("seasonal.calendar.prevMonth")}
              title={t("seasonal.calendar.prevMonth")}
              className="text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex size-5 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <ChevronLeft className="size-3.5" aria-hidden />
            </button>
            <h2 className="text-foreground px-1 text-center text-xs font-semibold">
              {formatMonthYear(viewYear, viewMonth, locale)}
            </h2>
            <button
              type="button"
              onClick={() => shiftHomeMonth(1)}
              aria-label={t("seasonal.calendar.nextMonth")}
              title={t("seasonal.calendar.nextMonth")}
              className="text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex size-5 cursor-pointer items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          </div>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() =>
                openModalForDate(nextUpcoming ? nextUpcoming.event_date : todayKey)
              }
              className="text-primary hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
            >
              <CalendarDays className="size-3" aria-hidden />
              {t("seasonal.calendar.viewAll")}
            </button>
            {isAdmin ? (
              <Link
                href="/admin/settings?tab=seasonal"
                aria-label={t("seasonal.calendar.manageEffects")}
                title={t("seasonal.calendar.manageEffects")}
                className="text-muted-foreground hover:text-foreground hover:bg-surface-hover focus-visible:ring-ring flex size-5 items-center justify-center rounded transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
              >
                <Settings2 className="size-3" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>

        <div className="mb-0.5 grid grid-cols-7 text-center">
          {weekdays.map((wd) => (
            <span
              key={wd}
              className="text-muted-foreground text-[10px] font-medium"
            >
              {wd}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {homeCells.map((cell, index) => {
            if (cell.day === null) {
              return <div key={`blank-${index}`} className="h-6" />;
            }

            const key = toIsoKey(viewYear, viewMonth, cell.day);
            const dayEvents = lookupEvents(eventsIndex, key);
            const hasEvents = dayEvents.length > 0;
            const isToday = key === todayKey;
            const hasPublicHoliday = dayEvents.some((e) => e.is_public_holiday);
            const isHovered = hoveredKey === key && hasEvents;

            const horizontalAlign =
              cell.col <= 1
                ? "left-0"
                : cell.col >= 5
                  ? "right-0"
                  : "left-1/2 -translate-x-1/2";
            const verticalPos =
              cell.row <= 1 ? "top-full mt-1.5" : "bottom-full mb-1.5";

            return (
              <div
                key={key}
                className="relative"
                onMouseEnter={() => {
                  if (hasEvents) openHover(key);
                }}
                onMouseLeave={() => {
                  if (hasEvents) scheduleCloseHover();
                }}
              >
                <button
                  type="button"
                  disabled={!hasEvents}
                  onFocus={() => {
                    if (hasEvents) openHover(key);
                  }}
                  onClick={() => {
                    if (hasEvents) openModalForDate(key);
                  }}
                  aria-label={
                    hasEvents
                      ? `${cell.day}: ${dayEvents
                          .map((e) => (locale === "vi" ? e.name_vi : e.name_en))
                          .join(", ")}`
                      : String(cell.day)
                  }
                  className={cn(
                    "focus-visible:ring-ring relative flex h-6 w-full flex-col items-center justify-center rounded text-[11px] tabular-nums transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                    isToday && hasEvents
                      ? "bg-primary text-primary-foreground cursor-pointer font-semibold hover:opacity-90"
                      : isToday
                        ? "border-primary/60 bg-primary-subtle text-primary border font-semibold"
                        : hasEvents
                          ? hasPublicHoliday
                            ? "bg-success-bg/85 text-success hover:bg-success-bg cursor-pointer font-semibold"
                            : "bg-primary-subtle/85 text-primary hover:bg-primary-subtle cursor-pointer font-semibold"
                          : "text-foreground/80 cursor-default",
                  )}
                >
                  <span className="leading-none">{cell.day}</span>
                  {hasEvents ? (
                    <span
                      className={cn(
                        "mt-0.5 size-1 rounded-full",
                        isToday
                          ? "bg-primary-foreground"
                          : hasPublicHoliday
                            ? "bg-success"
                            : "bg-primary",
                      )}
                    />
                  ) : null}
                </button>

                {isHovered ? (
                  <div
                    role="tooltip"
                    onMouseEnter={() => openHover(key)}
                    onMouseLeave={scheduleCloseHover}
                    className={cn(
                      "border-border bg-surface-raised absolute z-40 w-56 rounded-lg border p-2.5 text-left shadow-lg",
                      horizontalAlign,
                      verticalPos,
                    )}
                  >
                    <div className="space-y-2">
                      {dayEvents.map((ev) => {
                        const name = locale === "vi" ? ev.name_vi : ev.name_en;
                        return (
                          <div key={ev.event_id} className="space-y-1">
                            <div className="flex items-start justify-between gap-1.5">
                              <p className="text-foreground text-xs font-semibold leading-snug">
                                {name}
                              </p>
                              {renderCountdown(ev)}
                            </div>
                            <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span>{formatShortDate(ev.event_date, locale)}</span>
                              {ev.lunar_label ? <span>· {ev.lunar_label}</span> : null}
                            </div>
                            {ev.is_public_holiday && ev.holiday_days > 0 ? (
                              <span className="bg-success-bg text-success inline-block rounded px-1.5 py-0.5 text-[10px] font-medium">
                                {t("seasonal.calendar.daysOff", {
                                  days: ev.holiday_days,
                                })}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    <div className="border-border mt-2 border-t pt-1.5">
                      <button
                        type="button"
                        onClick={() => openModalForDate(key)}
                        className="text-primary hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center justify-between rounded px-1.5 py-1 text-[11px] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <span>{t("seasonal.calendar.viewDetail")}</span>
                        <ChevronRight className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {nextUpcoming ? (
          <button
            type="button"
            onClick={() => openModalForDate(nextUpcoming.event_date)}
            className="border-border hover:bg-surface-hover focus-visible:ring-ring mt-1.5 flex w-full cursor-pointer items-center justify-between gap-2 border-t pt-1.5 text-left text-[11px] transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground mr-1">
                {nextUpcoming.is_today
                  ? `${t("seasonal.calendar.today")}:`
                  : `${t("seasonal.calendar.nextUp")}:`}
              </span>
              <span className="text-foreground font-medium">
                {locale === "vi" ? nextUpcoming.name_vi : nextUpcoming.name_en}
              </span>
            </span>
            {renderCountdown(nextUpcoming)}
          </button>
        ) : null}

        {nextReminder ? (
          <div
            role="status"
            title={t("seasonal.banner.upcomingTitle", {
              name:
                locale === "vi" ? nextReminder.name_vi : nextReminder.name_en,
              days: nextReminder.days_until,
            })}
            className="bg-primary-subtle mt-1.5 flex items-center justify-between gap-2 rounded-md py-1 pr-1 pl-2 text-[11px]"
          >
            <span className="text-primary min-w-0 truncate font-medium">
              {t(
                nextReminder.auto_activate
                  ? "seasonal.calendar.reminderAuto"
                  : "seasonal.calendar.reminderManual",
                {
                  name:
                    locale === "vi"
                      ? nextReminder.name_vi
                      : nextReminder.name_en,
                  date: formatDayMonth(nextReminder.starts_on, locale),
                },
              )}
            </span>
            <button
              type="button"
              onClick={() => void activateReminder(nextReminder)}
              disabled={activating}
              className="text-primary hover:bg-primary/10 active:bg-primary/15 focus-visible:ring-ring inline-flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-semibold transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default disabled:opacity-60"
            >
              <Sparkles className="size-3" aria-hidden />
              {t("seasonal.banner.activateNow")}
            </button>
          </div>
        ) : null}
      </section>

      {/* Unified Two-Column Calendar Detail Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent
          className="max-w-3xl"
          title={
            <span className="flex items-center gap-2">
              <CalendarDays className="text-primary size-4" aria-hidden />
              {t("seasonal.calendar.modalTitle")}
            </span>
          }
        >
          <div className="grid gap-5 md:h-[31rem] md:grid-cols-[19rem_minmax(0,1fr)]">
            {/* LEFT SIDE: Interactive Month Calendar */}
            <div className="border-border flex min-h-0 flex-col gap-3 md:border-r md:pr-5">
              {/* Month navigation */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => shiftModalMonth(-1)}
                  aria-label={t("seasonal.calendar.prevMonth")}
                  className="text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <span className="text-foreground text-sm font-semibold">
                  {formatMonthYear(modalYear, modalMonth, locale)}
                </span>
                <button
                  type="button"
                  onClick={() => shiftModalMonth(1)}
                  aria-label={t("seasonal.calendar.nextMonth")}
                  className="text-muted-foreground hover:text-foreground hover:bg-surface-hover active:bg-surface-selected focus-visible:ring-ring flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </div>

              {/* Calendar grid */}
              <div>
                <div className="mb-1.5 grid grid-cols-7 text-center">
                  {weekdays.map((wd) => (
                    <span
                      key={wd}
                      className="text-muted-foreground text-[11px] font-medium"
                    >
                      {wd}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {modalCells.map((cell, index) => {
                    if (cell.day === null) {
                      return <div key={`mblank-${index}`} className="h-9" />;
                    }

                    const key = toIsoKey(modalYear, modalMonth, cell.day);
                    const dayEvents = lookupEvents(eventsIndex, key);
                    const hasEvents = dayEvents.length > 0;
                    const isToday = key === todayKey;
                    const isSelected = key === selectedDateKey;
                    const hasPublicHoliday = dayEvents.some(
                      (e) => e.is_public_holiday,
                    );

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedDateKey(key)}
                        className={cn(
                          "focus-visible:ring-ring relative flex h-9 w-full cursor-pointer flex-col items-center justify-center rounded-md text-xs tabular-nums transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                          isSelected
                            ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                            : isToday
                              ? "border-primary/60 bg-primary-subtle text-primary border font-semibold hover:bg-primary-subtle"
                              : hasEvents
                                ? hasPublicHoliday
                                  ? "bg-success-bg/85 text-success hover:bg-success-bg font-semibold"
                                  : "bg-primary-subtle/80 text-primary hover:bg-primary-subtle font-semibold"
                                : "text-foreground/80 hover:bg-surface-hover",
                        )}
                      >
                        <span className="leading-none">{cell.day}</span>
                        {hasEvents ? (
                          <span
                            className={cn(
                              "mt-1 size-1.5 rounded-full",
                              isSelected
                                ? "bg-primary-foreground"
                                : hasPublicHoliday
                                  ? "bg-success"
                                  : "bg-primary",
                            )}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Compact legend + quick Today button */}
              <div className="border-border flex items-center justify-between gap-2 border-t pt-2.5 text-[11px]">
                <div className="text-muted-foreground flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="bg-success inline-block size-2 rounded-full" />
                    {t("seasonal.calendar.legendPublic")}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="bg-primary inline-block size-2 rounded-full" />
                    {t("seasonal.calendar.legendObservance")}
                  </span>
                </div>
                {modalYear !== today.getFullYear() ||
                modalMonth !== today.getMonth() ||
                selectedDateKey !== todayKey ? (
                  <button
                    type="button"
                    onClick={() => {
                      setModalYear(today.getFullYear());
                      setModalMonth(today.getMonth());
                      setSelectedDateKey(todayKey);
                    }}
                    className="text-primary hover:bg-surface-hover focus-visible:ring-ring cursor-pointer rounded px-1.5 py-0.5 font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {t("seasonal.calendar.jumpToday")}
                  </button>
                ) : null}
              </div>

              {/* Next event & next public holiday summary cards */}
              <div className="mt-auto space-y-2 pt-1">
                {nextFutureEvent ? (
                  <button
                    type="button"
                    onClick={() => {
                      const d = parseIsoDate(nextFutureEvent.event_date);
                      setModalYear(d.getFullYear());
                      setModalMonth(d.getMonth());
                      setSelectedDateKey(nextFutureEvent.event_date);
                    }}
                    className={cn(
                      "hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                      selectedDateKey === nextFutureEvent.event_date
                        ? "border-primary/40 bg-primary-subtle/50"
                        : "border-border bg-surface-sunken/35",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                        {t("seasonal.calendar.nextEventLabel")}
                      </p>
                      <p className="text-foreground truncate text-xs font-medium">
                        {locale === "vi"
                          ? nextFutureEvent.name_vi
                          : nextFutureEvent.name_en}
                      </p>
                      <p className="text-muted-foreground text-[11px] tabular-nums">
                        {formatShortDate(nextFutureEvent.event_date, locale)}
                        {nextFutureEvent.lunar_label
                          ? ` · ${nextFutureEvent.lunar_label}`
                          : ""}
                      </p>
                    </div>
                    {renderCountdown(nextFutureEvent)}
                  </button>
                ) : null}

                {nextPublicHoliday &&
                nextPublicHoliday.event_id !== nextFutureEvent?.event_id ? (
                  <button
                    type="button"
                    onClick={() => {
                      const d = parseIsoDate(nextPublicHoliday.event_date);
                      setModalYear(d.getFullYear());
                      setModalMonth(d.getMonth());
                      setSelectedDateKey(nextPublicHoliday.event_date);
                    }}
                    className={cn(
                      "hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                      selectedDateKey === nextPublicHoliday.event_date
                        ? "border-success/50 bg-success-bg/50"
                        : "border-border bg-surface-sunken/35",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-success text-[10px] font-medium uppercase tracking-wide">
                        {t("seasonal.calendar.nextPublicLabel")}
                      </p>
                      <p className="text-foreground truncate text-xs font-medium">
                        {locale === "vi"
                          ? nextPublicHoliday.name_vi
                          : nextPublicHoliday.name_en}
                      </p>
                      <p className="text-muted-foreground text-[11px] tabular-nums">
                        {formatShortDate(nextPublicHoliday.event_date, locale)}
                        {nextPublicHoliday.holiday_days > 0
                          ? ` · ${t("seasonal.calendar.daysOff", { days: nextPublicHoliday.holiday_days })}`
                          : ""}
                      </p>
                    </div>
                    {renderCountdown(nextPublicHoliday)}
                  </button>
                ) : null}
              </div>
            </div>

            {/* RIGHT SIDE: Selected Date / Event Details with Thumbnail */}
            <div className="flex min-h-0 min-w-0 flex-col gap-3">
              <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b pb-2">
                <p className="text-muted-foreground text-xs font-medium capitalize">
                  {formatFullDate(selectedDateKey, locale)}
                </p>
                {isAdmin ? (
                  <Button
                    size="sm"
                    variant="primary"
                    asChild
                    className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
                  >
                    <Link
                      href="/admin/settings?tab=seasonal"
                      onClick={() => setModalOpen(false)}
                    >
                      <Sparkles className="size-3.5" aria-hidden />
                      {t("seasonal.calendar.manageEffects")}
                    </Link>
                  </Button>
                ) : null}
              </div>

              {selectedEvents.length > 0 ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  {selectedEvents.map((item) => {
                    const name = locale === "vi" ? item.name_vi : item.name_en;
                    const note =
                      locale === "vi"
                        ? item.holiday_note_vi
                        : item.holiday_note_en;
                    const presetMeta = getSeasonalPresetMeta(item.preset);
                    const detail = HOLIDAY_DETAILS[item.event_id];
                    const itemReminder = reminderFor(item.event_id);
                    return (
                      <div
                        key={item.event_id}
                        className="border-border bg-surface-sunken/35 flex min-h-0 flex-1 flex-col gap-2.5 rounded-lg border p-3"
                      >
                        <HolidayThumbnail
                          eventId={item.event_id}
                          preset={item.preset}
                          label={name}
                        />

                        <div className="flex shrink-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-foreground text-sm font-semibold leading-snug">
                              {name}
                            </h3>
                            {detail ? (
                              <p className="text-muted-foreground mt-0.5 text-[11px]">
                                {locale === "vi"
                                  ? detail.originVi
                                  : detail.originEn}
                              </p>
                            ) : item.lunar_label ? (
                              <p className="text-muted-foreground mt-0.5 text-xs">
                                {item.lunar_label}
                              </p>
                            ) : null}
                          </div>
                          {renderCountdown(item)}
                        </div>

                        {item.is_public_holiday &&
                        (note || item.holiday_days > 0) ? (
                          <div className="bg-success-bg/85 text-success shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium">
                            {note ||
                              t("seasonal.calendar.daysOff", {
                                days: item.holiday_days,
                              })}
                          </div>
                        ) : null}

                        {detail ? (
                          <div className="wh-scroll min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 text-xs leading-relaxed">
                            <p className="text-foreground/90">
                              {locale === "vi"
                                ? detail.summaryVi
                                : detail.summaryEn}
                            </p>
                            <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-[11px]">
                              {(locale === "vi"
                                ? detail.highlightsVi
                                : detail.highlightsEn
                              ).map((line, idx) => (
                                <li key={idx}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div className="flex-1" />
                        )}

                        <div className="border-border mt-auto shrink-0 space-y-1.5 border-t pt-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">
                              {t("seasonal.calendar.effectWindow")}
                            </span>
                            <span className="text-foreground font-medium tabular-nums">
                              {formatShortDate(item.starts_on, locale)} –{" "}
                              {formatShortDate(item.ends_on, locale)}
                            </span>
                          </div>

                          {presetMeta ? (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">
                                {t("seasonal.calendar.effectPack")}
                              </span>
                              <span className="text-foreground inline-flex items-center gap-1.5 font-medium">
                                <span
                                  className="inline-block size-2.5 rounded-full"
                                  style={{
                                    background: presetMeta.accentPrimary,
                                  }}
                                />
                                {locale === "vi"
                                  ? presetMeta.labelVi
                                  : presetMeta.labelEn}
                              </span>
                            </div>
                          ) : null}

                          {itemReminder ? (
                            <div className="bg-primary-subtle/60 flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5">
                              <span className="text-muted-foreground min-w-0 text-[11px]">
                                {itemReminder.auto_activate
                                  ? t("seasonal.banner.autoNote", {
                                      date: formatDayMonth(
                                        itemReminder.starts_on,
                                        locale,
                                      ),
                                    })
                                  : t("seasonal.banner.manualNote", {
                                      date: formatDayMonth(
                                        itemReminder.starts_on,
                                        locale,
                                      ),
                                    })}
                              </span>
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => void activateReminder(itemReminder)}
                                disabled={activating}
                                className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
                              >
                                <Sparkles className="size-3.5" aria-hidden />
                                {t("seasonal.banner.activateNow")}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs">
                      {t("seasonal.calendar.noEventOnDay")}
                    </p>
                    <div className="space-y-1.5">
                      <p className="text-foreground text-xs font-medium">
                        {t("seasonal.calendar.nextUp")}:
                      </p>
                      {entries.slice(0, 3).map((ev) => (
                        <button
                          key={ev.event_id}
                          type="button"
                          onClick={() => {
                            const d = parseIsoDate(ev.event_date);
                            setModalYear(d.getFullYear());
                            setModalMonth(d.getMonth());
                            setSelectedDateKey(ev.event_date);
                          }}
                          className="border-border bg-surface hover:bg-surface-hover focus-visible:ring-ring flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <div className="min-w-0">
                            <p className="text-foreground truncate font-medium">
                              {locale === "vi" ? ev.name_vi : ev.name_en}
                            </p>
                            <p className="text-muted-foreground text-[11px]">
                              {formatShortDate(ev.event_date, locale)}
                              {ev.lunar_label ? ` · ${ev.lunar_label}` : ""}
                            </p>
                          </div>
                          {renderCountdown(ev)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
