"use client";

import {
  ArrowUpDown,
  Bell,
  Calendar,
  CalendarDays,
  CalendarOff,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  PartyPopper,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  SEASONAL_PRESETS,
  getSeasonalPresetMeta,
} from "@/components/seasonal/seasonal-presets";
import { ThumbScene } from "@/components/seasonal/seasonal-thumb-scenes";
import { useThemeSettings } from "@/components/theme-color-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  SeasonalCalendarType,
  SeasonalEffectPresetId,
  SeasonalEventItem,
  SeasonalThemeMode,
  SeasonalThemeSettings,
} from "@/types/api";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const WEEKDAYS_VI = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"];
const WEEKDAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function isComputedCalendar(item: SeasonalEventItem): boolean {
  return item.calendar_type === "easter" || item.calendar_type === "weekday";
}

/** Main date label, e.g. `19/05`, `15/08 ÂL`, "Easter Sunday", "2nd Sunday · May". */
function formatEventDate(item: SeasonalEventItem, locale: string): string {
  const vi = locale === "vi";
  if (item.calendar_type === "easter") return vi ? "Chủ nhật Phục sinh" : "Easter Sunday";
  if (item.calendar_type === "weekday") {
    const day = (vi ? WEEKDAYS_VI : WEEKDAYS_EN)[item.weekday] ?? "";
    const nth =
      item.week_of_month === -1
        ? vi
          ? "cuối cùng"
          : "last"
        : vi
          ? `thứ ${item.week_of_month}`
          : `#${item.week_of_month}`;
    return vi
      ? `${day} ${nth} · T${item.event_month}`
      : `${day} ${nth} · M${item.event_month}`;
  }
  return `${pad2(item.event_day)}/${pad2(item.event_month)}${
    item.calendar_type === "lunar" ? (vi ? " ÂL" : " Lunar") : ""
  }`;
}

function formatEventRange(item: SeasonalEventItem, locale: string): string {
  if (isComputedCalendar(item)) {
    return locale === "vi"
      ? `−${item.window_before} → +${item.window_after} ngày`
      : `−${item.window_before} → +${item.window_after} days`;
  }
  const suffix =
    item.calendar_type === "lunar"
      ? locale === "vi"
        ? " ÂL"
        : " Lunar"
      : "";
  const start = `${pad2(item.start_day)}/${pad2(item.start_month)}`;
  const end = `${pad2(item.end_day)}/${pad2(item.end_month)}`;
  return start === end ? `${start}${suffix}` : `${start} – ${end}${suffix}`;
}

function emptyCustomEvent(): SeasonalEventItem {
  return {
    id: `custom_${Date.now().toString(36)}`,
    builtin: false,
    name_en: "",
    name_vi: "",
    preset: "new_year",
    calendar_type: "solar",
    event_month: 1,
    event_day: 1,
    start_month: 1,
    start_day: 1,
    end_month: 1,
    end_day: 1,
    is_public_holiday: false,
    holiday_days: 0,
    holiday_note_en: null,
    holiday_note_vi: null,
    weekday: 0,
    week_of_month: 1,
    window_before: 2,
    window_after: 1,
    enabled: true,
    auto_activate: true,
    show_on_home_calendar: true,
  };
}

export function SeasonalThemeSettingsPanel({
  value,
  onChange,
  onResetDefaults,
  pending,
  dirty = false,
}: {
  value: SeasonalThemeSettings;
  onChange: (next: SeasonalThemeSettings) => void;
  onResetDefaults: () => void;
  pending: boolean;
  /** Unsaved edits exist; enables the header's Save button. */
  dirty?: boolean;
}) {
  const { locale, t } = useTranslation();
  const {
    seasonalTheme,
    previewSeasonalPreset,
    setPreviewSeasonalPreset,
  } = useThemeSettings();

  const [editingEvent, setEditingEvent] = useState<SeasonalEventItem | null>(null);
  const [isNewEvent, setIsNewEvent] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "on" | "off" | "custom">("all");

  // Stop live preview automatically if the admin leaves this panel.
  useEffect(() => {
    return () => {
      setPreviewSeasonalPreset(null);
    };
  }, [setPreviewSeasonalPreset]);

  function updateField<K extends keyof SeasonalThemeSettings>(
    key: K,
    nextVal: SeasonalThemeSettings[K],
  ) {
    onChange({ ...value, [key]: nextVal });
  }

  function updateEvent(id: string, patch: Partial<SeasonalEventItem>) {
    onChange({
      ...value,
      events: value.events.map((ev) => (ev.id === id ? { ...ev, ...patch } : ev)),
    });
  }

  function deleteEvent(id: string) {
    onChange({
      ...value,
      events: value.events.filter((ev) => ev.id !== id),
    });
  }

  function openAddEvent() {
    setIsNewEvent(true);
    setEditingEvent(emptyCustomEvent());
  }

  function openEditEvent(item: SeasonalEventItem) {
    setIsNewEvent(false);
    setEditingEvent({ ...item });
  }

  function saveEditingEvent() {
    if (!editingEvent) return;
    const cleaned: SeasonalEventItem = {
      ...editingEvent,
      name_vi: editingEvent.name_vi.trim() || editingEvent.name_en.trim(),
      name_en: editingEvent.name_en.trim() || editingEvent.name_vi.trim(),
      event_month: Math.min(12, Math.max(1, Number(editingEvent.event_month) || 1)),
      event_day: Math.min(31, Math.max(1, Number(editingEvent.event_day) || 1)),
      start_month: Math.min(12, Math.max(1, Number(editingEvent.start_month) || 1)),
      start_day: Math.min(31, Math.max(1, Number(editingEvent.start_day) || 1)),
      end_month: Math.min(12, Math.max(1, Number(editingEvent.end_month) || 1)),
      end_day: Math.min(31, Math.max(1, Number(editingEvent.end_day) || 1)),
      holiday_days: editingEvent.is_public_holiday
        ? Math.min(15, Math.max(1, Number(editingEvent.holiday_days) || 1))
        : 0,
    };
    if (!cleaned.name_vi) return;

    if (isNewEvent) {
      onChange({ ...value, events: [...value.events, cleaned] });
    } else {
      onChange({
        ...value,
        events: value.events.map((ev) => (ev.id === cleaned.id ? cleaned : ev)),
      });
    }
    setEditingEvent(null);
  }

  const modeOptions: Array<{
    id: SeasonalThemeMode;
    label: string;
    desc: string;
    icon: typeof Power;
  }> = [
    {
      id: "off",
      label: t("seasonal.admin.modeOff"),
      desc: t("seasonal.admin.modeOffDesc"),
      icon: Power,
    },
    {
      id: "auto",
      label: t("seasonal.admin.modeAuto"),
      desc: t("seasonal.admin.modeAutoDesc"),
      icon: Calendar,
    },
    {
      id: "manual",
      label: t("seasonal.admin.modeManual"),
      desc: t("seasonal.admin.modeManualDesc"),
      icon: Wand2,
    },
  ];
  const currentMode = modeOptions.find((m) => m.id === value.mode) ?? modeOptions[1];

  // What the workspace shows right now: the admin's live preview wins.
  const shownPreset: SeasonalEffectPresetId = previewSeasonalPreset ?? seasonalTheme.preset;
  const shownMeta = shownPreset !== "none" ? getSeasonalPresetMeta(shownPreset) : undefined;
  const shownName = previewSeasonalPreset
    ? label(getSeasonalPresetMeta(previewSeasonalPreset), previewSeasonalPreset)
    : shownMeta
      ? locale === "vi"
        ? seasonalTheme.event_name_vi || shownMeta.labelVi
        : seasonalTheme.event_name_en || shownMeta.labelEn
      : t("seasonal.admin.currentlyNone");

  function label(
    meta: ReturnType<typeof getSeasonalPresetMeta>,
    fallback: string,
  ): string {
    if (!meta) return fallback;
    return locale === "vi" ? meta.labelVi : meta.labelEn;
  }

  const usage = new Map<string, number>();
  for (const ev of value.events) {
    if (ev.enabled) usage.set(ev.preset, (usage.get(ev.preset) ?? 0) + 1);
  }

  const q = query.trim().toLowerCase();
  const visibleEvents = value.events.filter((ev) => {
    if (filter === "on" && !ev.enabled) return false;
    if (filter === "off" && ev.enabled) return false;
    if (filter === "custom" && ev.builtin) return false;
    if (!q) return true;
    return `${ev.name_vi} ${ev.name_en}`.toLowerCase().includes(q);
  });
  const enabledCount = value.events.filter((ev) => ev.enabled).length;

  const filters: Array<{ id: typeof filter; label: string }> = [
    { id: "all", label: t("seasonal.admin.filterAll") },
    { id: "on", label: t("seasonal.admin.filterOn") },
    { id: "off", label: t("seasonal.admin.filterOff") },
    { id: "custom", label: t("seasonal.admin.filterCustom") },
  ];

  return (
    <div className="space-y-6">
      {/* Sticky header, same pattern as the other settings tabs */}
      <div className="border-border bg-surface/98 sticky top-topbar z-20 flex items-center justify-between gap-3 border-b py-3.5 backdrop-blur-md">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <PartyPopper className="text-primary size-5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <h3 className="text-foreground text-sm font-semibold sm:text-base">
              {t("seasonal.admin.title")}
            </h3>
            <p className="text-muted-foreground mt-0.5 hidden text-xs sm:block">
              {t("seasonal.admin.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {dirty ? (
            <span className="text-warning hidden items-center gap-1.5 text-xs font-medium sm:flex">
              <span className="bg-warning size-1.5 rounded-full" aria-hidden />
              {t("seasonal.admin.unsaved")}
            </span>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="h-8 gap-1.5 text-xs font-semibold shadow-xs"
            disabled={pending || !dirty}
          >
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {t("seasonal.admin.saving")}
              </>
            ) : (
              <>
                <Save className="size-3.5" aria-hidden />
                {t("seasonal.admin.saveChanges")}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Now showing + mode */}
      <section className="border-border bg-surface overflow-hidden rounded-lg border">
        <div className="grid md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div className="border-border relative h-36 border-b md:h-auto md:min-h-44 md:border-r md:border-b-0">
            {shownMeta ? (
              <div className="absolute inset-0" style={{ background: shownMeta.swatchGradient }}>
                <ThumbScene preset={shownPreset} />
              </div>
            ) : (
              <div className="bg-surface-sunken text-muted-foreground absolute inset-0 flex items-center justify-center">
                <CalendarOff className="size-8 opacity-50" aria-hidden />
              </div>
            )}
            {shownMeta ? (
              <span
                className={cn(
                  "absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm",
                  previewSeasonalPreset
                    ? "bg-surface text-primary"
                    : "bg-surface text-success",
                )}
              >
                {previewSeasonalPreset ? (
                  <Eye className="size-3" aria-hidden />
                ) : (
                  <span className="bg-success size-1.5 rounded-full" aria-hidden />
                )}
                {previewSeasonalPreset
                  ? t("seasonal.admin.previewTag")
                  : t("seasonal.admin.liveTag")}
              </span>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-4 p-5">
            <div className="min-w-0">
              <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.06em] uppercase">
                {t("seasonal.admin.nowShowing")}
              </p>
              <p className="text-foreground mt-1 truncate text-lg font-semibold">{shownName}</p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                {shownMeta
                  ? locale === "vi"
                    ? shownMeta.descVi
                    : shownMeta.descEn
                  : t("seasonal.admin.noneDesc")}
              </p>
              {previewSeasonalPreset ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {t("seasonal.admin.previewing", { name: shownName })}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setPreviewSeasonalPreset(null)}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <EyeOff className="size-3.5" aria-hidden />
                    {t("seasonal.admin.stopPreview")}
                  </Button>
                </div>
              ) : null}
            </div>

            <div>
              <p
                id="seasonal-mode-label"
                className="text-foreground mb-1.5 text-xs font-medium"
              >
                {t("seasonal.admin.modeLabel")}
              </p>
              <div
                role="radiogroup"
                aria-labelledby="seasonal-mode-label"
                className="bg-surface-sunken border-border inline-flex w-full max-w-md rounded-md border p-0.5"
              >
                {modeOptions.map((opt) => {
                  const Icon = opt.icon;
                  const selected = value.mode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={pending}
                      onClick={() => updateField("mode", opt.id)}
                      className={cn(
                        "focus-visible:ring-ring flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed",
                        selected
                          ? "bg-surface text-primary shadow-xs"
                          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <Icon className="size-3.5 shrink-0" aria-hidden />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                {currentMode.desc}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Preset gallery */}
      <section className="border-border bg-surface rounded-lg border p-5">
        <div className="mb-4">
          <h4 className="text-foreground text-sm font-semibold">
            {t("seasonal.admin.presetsTitle")}
            <span className="text-muted-foreground ml-1.5 font-normal">
              {SEASONAL_PRESETS.length}
            </span>
          </h4>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {value.mode === "manual"
              ? t("seasonal.admin.presetsManualHint")
              : t("seasonal.admin.presetsPreviewHint")}
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
          {SEASONAL_PRESETS.map((preset) => {
            const isSelectedManual =
              value.mode === "manual" && value.manual_preset === preset.id;
            const isPreviewing = previewSeasonalPreset === preset.id;
            const isLive = !previewSeasonalPreset && seasonalTheme.preset === preset.id;
            const name = locale === "vi" ? preset.labelVi : preset.labelEn;
            const used = usage.get(preset.id) ?? 0;
            return (
              <div
                key={preset.id}
                className={cn(
                  "group bg-surface flex flex-col overflow-hidden rounded-lg border transition-[border-color,box-shadow] duration-150",
                  isSelectedManual || isPreviewing
                    ? "border-primary ring-primary/25 ring-2"
                    : "border-border hover:border-border-strong hover:shadow-sm",
                )}
              >
                <button
                  type="button"
                  aria-pressed={isPreviewing}
                  aria-label={`${isPreviewing ? t("seasonal.admin.stopPreview") : t("seasonal.admin.preview")}: ${name}`}
                  onClick={() => setPreviewSeasonalPreset(isPreviewing ? null : preset.id)}
                  className="focus-visible:ring-ring relative h-20 w-full cursor-pointer overflow-hidden focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                  style={{ background: preset.swatchGradient }}
                >
                  <span className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.04]">
                    <ThumbScene preset={preset.id} />
                  </span>
                  <span
                    className={cn(
                      "bg-surface/95 text-foreground absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shadow-sm transition-opacity duration-150",
                      isPreviewing
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                    )}
                  >
                    {isPreviewing ? (
                      <EyeOff className="size-3" aria-hidden />
                    ) : (
                      <Eye className="size-3" aria-hidden />
                    )}
                    {isPreviewing ? t("seasonal.admin.stopPreview") : t("seasonal.admin.preview")}
                  </span>
                  {isLive ? (
                    <span className="bg-surface/95 text-success absolute top-2 left-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm">
                      <span className="bg-success size-1.5 rounded-full" aria-hidden />
                      {t("seasonal.admin.liveTag")}
                    </span>
                  ) : null}
                </button>

                <div className="flex flex-1 flex-col p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-foreground text-sm font-semibold">{name}</p>
                    {isSelectedManual ? (
                      <Check className="text-primary size-4 shrink-0" aria-hidden />
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
                    {locale === "vi" ? preset.descVi : preset.descEn}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                      <CalendarDays className="size-3" aria-hidden />
                      {used > 0
                        ? t("seasonal.admin.usedBy", { count: used })
                        : t("seasonal.admin.usedByNone")}
                    </span>
                    {value.mode === "manual" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={isSelectedManual ? "secondary" : "primary"}
                        disabled={pending || isSelectedManual}
                        onClick={() => updateField("manual_preset", preset.id)}
                        className="h-7 px-2.5 text-xs"
                      >
                        {isSelectedManual
                          ? t("seasonal.admin.selected")
                          : t("seasonal.admin.choose")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Holiday calendar */}
      <section className="border-border bg-surface rounded-lg border">
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h4 className="text-foreground text-sm font-semibold">
              {t("seasonal.admin.eventsTitle")}
              <span className="text-muted-foreground ml-1.5 font-normal">
                {t("seasonal.admin.eventsOnCount", {
                  on: enabledCount,
                  total: value.events.length,
                })}
              </span>
            </h4>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t("seasonal.admin.eventsDesc")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setResetConfirmOpen(true)}
              className="h-8 gap-1.5 text-xs"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t("seasonal.admin.resetDefaults")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={openAddEvent}
              className="h-8 gap-1.5 text-xs"
            >
              <Plus className="size-3.5" aria-hidden />
              {t("seasonal.admin.addEvent")}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <div className="relative w-full sm:w-64">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("seasonal.admin.searchEvents")}
              aria-label={t("seasonal.admin.searchEvents")}
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div
            role="radiogroup"
            aria-label={t("seasonal.admin.colEnabled")}
            className="bg-surface-sunken border-border inline-flex rounded-md border p-0.5"
          >
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "focus-visible:ring-ring cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
                  filter === f.id
                    ? "bg-surface text-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] sm:ml-auto">
            <ArrowUpDown className="size-3" aria-hidden />
            {t("seasonal.admin.priorityHint")}
          </p>
        </div>

        <div className="border-border overflow-x-auto border-t">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-surface-sunken text-muted-foreground border-border border-b">
              <tr>
                <th className="py-2 pr-3 pl-5 font-medium">{t("seasonal.admin.colEvent")}</th>
                <th className="px-3 py-2 font-medium">{t("seasonal.admin.colWindow")}</th>
                <th className="px-3 py-2 font-medium">{t("seasonal.admin.colPreset")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("seasonal.admin.colAuto")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("seasonal.admin.colHome")}</th>
                <th className="px-3 py-2 text-center font-medium">{t("seasonal.admin.colEnabled")}</th>
                <th className="py-2 pr-5 pl-3 text-right font-medium">
                  <span className="sr-only">{t("seasonal.admin.colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {visibleEvents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground px-5 py-8 text-center text-xs">
                    {t("seasonal.admin.noMatch")}
                  </td>
                </tr>
              ) : null}
              {visibleEvents.map((ev) => {
                const presetMeta = getSeasonalPresetMeta(ev.preset);
                const evName = locale === "vi" ? ev.name_vi : ev.name_en;
                return (
                  <tr
                    key={ev.id}
                    className="group hover:bg-surface-hover transition-colors duration-150"
                  >
                    <td className={cn("py-2.5 pr-3 pl-5", !ev.enabled && "opacity-55")}>
                      <div className="text-foreground font-medium">{evName}</div>
                      <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="tabular-nums">{formatEventDate(ev, locale)}</span>
                        {ev.is_public_holiday && ev.holiday_days > 0 ? (
                          <Badge variant="success" className="text-[10px]">
                            {t("seasonal.calendar.daysOff", { days: ev.holiday_days })}
                          </Badge>
                        ) : null}
                        {!ev.builtin ? (
                          <Badge variant="neutral" className="text-[10px]">
                            {t("seasonal.admin.customBadge")}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td
                      className={cn(
                        "text-muted-foreground px-3 py-2.5 whitespace-nowrap tabular-nums",
                        !ev.enabled && "opacity-55",
                      )}
                    >
                      {formatEventRange(ev, locale)}
                    </td>
                    <td className={cn("px-3 py-2.5 whitespace-nowrap", !ev.enabled && "opacity-55")}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="border-border inline-block h-4 w-6 shrink-0 rounded-sm border"
                          style={{ background: presetMeta?.swatchGradient }}
                          aria-hidden
                        />
                        <span className="text-foreground">{label(presetMeta, ev.preset)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Switch
                        size="sm"
                        aria-label={`${t("seasonal.admin.colAuto")}: ${evName}`}
                        checked={ev.auto_activate}
                        disabled={pending || !ev.enabled}
                        onCheckedChange={(v) => updateEvent(ev.id, { auto_activate: v })}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Switch
                        size="sm"
                        aria-label={`${t("seasonal.admin.colHome")}: ${evName}`}
                        checked={ev.show_on_home_calendar}
                        disabled={pending || !ev.enabled}
                        onCheckedChange={(v) =>
                          updateEvent(ev.id, { show_on_home_calendar: v })
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Switch
                        size="sm"
                        aria-label={`${t("seasonal.admin.colEnabled")}: ${evName}`}
                        checked={ev.enabled}
                        disabled={pending}
                        onCheckedChange={(v) => updateEvent(ev.id, { enabled: v })}
                      />
                    </td>
                    <td className="py-2.5 pr-5 pl-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => openEditEvent(ev)}
                          aria-label={t("seasonal.admin.editEvent")}
                          title={t("seasonal.admin.editEvent")}
                          className="size-7"
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </Button>
                        {!ev.builtin ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => deleteEvent(ev.id)}
                            aria-label={t("seasonal.admin.deleteEvent")}
                            title={t("seasonal.admin.deleteEvent")}
                            className="text-danger hover:text-danger hover:bg-danger-bg size-7"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Admin reminders */}
      <section className="border-border bg-surface rounded-lg border p-5">
        <h4 className="text-foreground flex items-center gap-2 text-sm font-semibold">
          <Bell className="text-muted-foreground size-4" aria-hidden />
          {t("seasonal.admin.remindersTitle")}
        </h4>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t("seasonal.admin.remindersDesc")}
        </p>

        <div className="border-border divide-border mt-4 divide-y rounded-md border">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p id="seasonal-reminder-label" className="text-foreground text-sm font-medium">
                {t("seasonal.admin.reminderEnabled")}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t("seasonal.admin.reminderEnabledHint")}
              </p>
            </div>
            <Switch
              aria-labelledby="seasonal-reminder-label"
              checked={value.reminder_enabled}
              disabled={pending}
              onCheckedChange={(v) => updateField("reminder_enabled", v)}
            />
          </div>

          {value.reminder_enabled ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                <Label htmlFor="seasonal-reminder-days" className="text-sm font-medium">
                  {t("seasonal.admin.reminderDaysBefore")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="seasonal-reminder-days"
                    type="number"
                    min={1}
                    max={30}
                    disabled={pending}
                    value={value.reminder_days_before}
                    onChange={(e) =>
                      updateField(
                        "reminder_days_before",
                        Math.min(30, Math.max(1, Number(e.target.value) || 7)),
                      )
                    }
                    className="h-8 w-20 text-center text-sm"
                  />
                  <span className="text-muted-foreground text-xs">
                    {t("seasonal.admin.daysUnit")}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p
                    id="seasonal-reminder-mail-label"
                    className="text-foreground flex items-center gap-1.5 text-sm font-medium"
                  >
                    <Mail className="text-muted-foreground size-3.5" aria-hidden />
                    {t("seasonal.admin.reminderSendEmail")}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {t("seasonal.admin.reminderSendEmailHint")}{" "}
                    <Link
                      href="/admin/mail"
                      className="text-primary hover:text-primary-hover underline-offset-2 hover:underline"
                    >
                      {t("seasonal.admin.configureMailLink")}
                    </Link>
                  </p>
                </div>
                <Switch
                  aria-labelledby="seasonal-reminder-mail-label"
                  checked={value.reminder_send_email}
                  disabled={pending}
                  onCheckedChange={(v) => updateField("reminder_send_email", v)}
                />
              </div>
            </>
          ) : null}
        </div>
      </section>

      {/* Add / Edit Event Dialog */}
      <Dialog
        open={editingEvent !== null}
        onOpenChange={(open) => {
          if (!open) setEditingEvent(null);
        }}
      >
        <DialogContent
          className="max-w-lg"
          title={
            isNewEvent
              ? t("seasonal.admin.addEventTitle")
              : t("seasonal.admin.editEventTitle")
          }
        >

          {editingEvent ? (
            <div className="space-y-3.5 py-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="ev-name-vi" className="text-xs">
                    {t("seasonal.admin.fieldNameVi")}
                  </Label>
                  <Input
                    id="ev-name-vi"
                    value={editingEvent.name_vi}
                    onChange={(e) =>
                      setEditingEvent({ ...editingEvent, name_vi: e.target.value })
                    }
                    className="mt-1 h-8 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="ev-name-en" className="text-xs">
                    {t("seasonal.admin.fieldNameEn")}
                  </Label>
                  <Input
                    id="ev-name-en"
                    value={editingEvent.name_en}
                    onChange={(e) =>
                      setEditingEvent({ ...editingEvent, name_en: e.target.value })
                    }
                    className="mt-1 h-8 text-sm"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">{t("seasonal.admin.fieldCalendar")}</Label>
                  <Select
                    value={editingEvent.calendar_type}
                    onValueChange={(v) =>
                      setEditingEvent({
                        ...editingEvent,
                        calendar_type: v as SeasonalCalendarType,
                      })
                    }
                  >
                    <SelectTrigger className="mt-1 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="solar">
                        {t("seasonal.admin.calendarSolar")}
                      </SelectItem>
                      <SelectItem value="lunar">
                        {t("seasonal.admin.calendarLunar")}
                      </SelectItem>
                      {isComputedCalendar(editingEvent) ? (
                        <SelectItem value={editingEvent.calendar_type}>
                          {t(
                            editingEvent.calendar_type === "easter"
                              ? "seasonal.admin.calendarEaster"
                              : "seasonal.admin.calendarWeekday",
                          )}
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">{t("seasonal.admin.colPreset")}</Label>
                  <Select
                    value={editingEvent.preset}
                    onValueChange={(v) =>
                      setEditingEvent({
                        ...editingEvent,
                        preset: v as SeasonalEffectPresetId,
                      })
                    }
                  >
                    <SelectTrigger className="mt-1 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEASONAL_PRESETS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {locale === "vi" ? p.labelVi : p.labelEn}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Primary date + active window */}
              {isComputedCalendar(editingEvent) ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-1">
                    <Label className="text-xs">{t("seasonal.admin.fieldMainDate")}</Label>
                    <p className="text-muted-foreground mt-2 text-xs">
                      {formatEventDate(editingEvent, locale)}
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="ev-win-before" className="text-xs">
                      {t("seasonal.admin.fieldWindowBefore")}
                    </Label>
                    <Input
                      id="ev-win-before"
                      type="number"
                      min={0}
                      max={30}
                      value={editingEvent.window_before}
                      onChange={(e) =>
                        setEditingEvent({
                          ...editingEvent,
                          window_before: Math.min(30, Math.max(0, Number(e.target.value) || 0)),
                        })
                      }
                      className="mt-1 h-8 text-center text-sm"
                    />
                  </div>
                  <div>
                    <Label htmlFor="ev-win-after" className="text-xs">
                      {t("seasonal.admin.fieldWindowAfter")}
                    </Label>
                    <Input
                      id="ev-win-after"
                      type="number"
                      min={0}
                      max={30}
                      value={editingEvent.window_after}
                      onChange={(e) =>
                        setEditingEvent({
                          ...editingEvent,
                          window_after: Math.min(30, Math.max(0, Number(e.target.value) || 0)),
                        })
                      }
                      className="mt-1 h-8 text-center text-sm"
                    />
                  </div>
                </div>
              ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">{t("seasonal.admin.fieldMainDate")}</Label>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      aria-label="Day"
                      value={editingEvent.event_day}
                      onChange={(e) =>
                        setEditingEvent({
                          ...editingEvent,
                          event_day: Number(e.target.value) || 1,
                        })
                      }
                      className="h-8 text-center text-sm"
                    />
                    <span className="text-muted-foreground">/</span>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      aria-label="Month"
                      value={editingEvent.event_month}
                      onChange={(e) =>
                        setEditingEvent({
                          ...editingEvent,
                          event_month: Number(e.target.value) || 1,
                        })
                      }
                      className="h-8 text-center text-sm"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">{t("seasonal.admin.fieldStartDate")}</Label>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={editingEvent.start_day}
                      onChange={(e) =>
                        setEditingEvent({
                          ...editingEvent,
                          start_day: Number(e.target.value) || 1,
                        })
                      }
                      className="h-8 text-center text-sm"
                    />
                    <span className="text-muted-foreground">/</span>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={editingEvent.start_month}
                      onChange={(e) =>
                        setEditingEvent({
                          ...editingEvent,
                          start_month: Number(e.target.value) || 1,
                        })
                      }
                      className="h-8 text-center text-sm"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">{t("seasonal.admin.fieldEndDate")}</Label>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={editingEvent.end_day}
                      onChange={(e) =>
                        setEditingEvent({
                          ...editingEvent,
                          end_day: Number(e.target.value) || 1,
                        })
                      }
                      className="h-8 text-center text-sm"
                    />
                    <span className="text-muted-foreground">/</span>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={editingEvent.end_month}
                      onChange={(e) =>
                        setEditingEvent({
                          ...editingEvent,
                          end_month: Number(e.target.value) || 1,
                        })
                      }
                      className="h-8 text-center text-sm"
                    />
                  </div>
                </div>
              </div>
              )}

              {/* Public holiday toggle */}
              <div className="border-border flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={editingEvent.is_public_holiday}
                    onChange={(e) =>
                      setEditingEvent({
                        ...editingEvent,
                        is_public_holiday: e.target.checked,
                        holiday_days: e.target.checked
                          ? Math.max(1, editingEvent.holiday_days)
                          : 0,
                      })
                    }
                    className="accent-primary size-3.5 cursor-pointer"
                  />
                  {t("seasonal.admin.fieldPublicHoliday")}
                </label>

                {editingEvent.is_public_holiday ? (
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="ev-days-off" className="text-xs">
                      {t("seasonal.admin.fieldDaysOff")}
                    </Label>
                    <Input
                      id="ev-days-off"
                      type="number"
                      min={1}
                      max={15}
                      value={editingEvent.holiday_days}
                      onChange={(e) =>
                        setEditingEvent({
                          ...editingEvent,
                          holiday_days: Number(e.target.value) || 1,
                        })
                      }
                      className="h-7 w-16 text-center text-xs"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditingEvent(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={
                !editingEvent ||
                (!editingEvent.name_vi.trim() && !editingEvent.name_en.trim())
              }
              onClick={saveEditingEvent}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset defaults confirmation modal (never window.confirm) */}
      <Dialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <DialogContent
          className="max-w-md"
          title={t("seasonal.admin.resetConfirmTitle")}
        >
          <p className="text-muted-foreground text-sm">
            {t("seasonal.admin.resetConfirmDesc")}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setResetConfirmOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setResetConfirmOpen(false);
                onResetDefaults();
              }}
            >
              {t("seasonal.admin.resetDefaults")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
