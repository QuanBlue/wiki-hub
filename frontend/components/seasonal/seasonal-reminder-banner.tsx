"use client";

import { CalendarClock, Settings2, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useThemeSettings } from "@/components/theme-color-provider";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n/context";
import type { SiteSettings, UpcomingSeasonalReminder } from "@/types/api";

const DISMISSED_STORAGE_KEY = "wikihub:seasonal-banner-dismissed";

function readDismissedKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedKey(key: string) {
  if (typeof window === "undefined") return;
  const set = readDismissedKeys();
  set.add(key);
  try {
    window.localStorage.setItem(
      DISMISSED_STORAGE_KEY,
      JSON.stringify(Array.from(set).slice(-50)),
    );
  } catch {
    // Ignore storage quota issues.
  }
}

/**
 * Admin-only top banner reminding system administrators about an upcoming
 * holiday within `reminder_days_before` days, with one-click activation.
 */
export function SeasonalReminderBanner({
  isAdmin,
}: {
  isAdmin: boolean;
}) {
  const { locale, t } = useTranslation();
  const { seasonalTheme, setSeasonalTheme } = useThemeSettings();
  const [reminders, setReminders] = useState<UpcomingSeasonalReminder[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    setDismissed(readDismissedKeys());
  }, []);

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

  if (!isAdmin || reminders.length === 0) return null;

  const next = reminders.find(
    (item) =>
      !dismissed.has(item.occurrence_key) &&
      seasonalTheme.preset !== item.preset,
  );
  if (!next) return null;

  const eventName = locale === "vi" ? next.name_vi : next.name_en;
  const startsFormatted = new Intl.DateTimeFormat(
    locale === "vi" ? "vi-VN" : "en-US",
    { day: "2-digit", month: "2-digit" },
  ).format(new Date(`${next.starts_on}T00:00:00`));

  async function handleActivateNow() {
    if (!next || activating) return;
    setActivating(true);
    try {
      await api.post<SiteSettings>("/api/v1/settings/seasonal-theme/activate", {
        preset: next.preset,
      });
      setSeasonalTheme({
        preset: next.preset,
        event_id: next.event_id,
        event_name_en: next.name_en,
        event_name_vi: next.name_vi,
        source: "manual",
      });
      toast.success(
        t("seasonal.banner.activatedToast", { name: eventName }),
      );
    } catch {
      toast.error(t("seasonal.banner.activateFailed"));
    } finally {
      setActivating(false);
    }
  }

  function handleDismiss() {
    if (!next) return;
    saveDismissedKey(next.occurrence_key);
    setDismissed((prev) => new Set(prev).add(next.occurrence_key));
  }

  return (
    <div
      role="status"
      className="border-primary/25 bg-surface bg-[linear-gradient(var(--primary-subtle),var(--primary-subtle))] text-foreground mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-sm"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
          <CalendarClock className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium leading-snug">
            {t("seasonal.banner.upcomingTitle", {
              name: eventName,
              days: next.days_until,
            })}
          </p>
          <p className="text-muted-foreground text-xs">
            {next.auto_activate
              ? t("seasonal.banner.autoNote", { date: startsFormatted })
              : t("seasonal.banner.manualNote", { date: startsFormatted })}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="primary"
          onClick={handleActivateNow}
          disabled={activating}
          className="h-7 gap-1.5 px-2.5 text-xs"
        >
          <Sparkles className="size-3.5" aria-hidden />
          {t("seasonal.banner.activateNow")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          asChild
          className="h-7 gap-1.5 px-2.5 text-xs"
        >
          <Link href="/admin/settings?tab=seasonal">
            <Settings2 className="size-3.5" aria-hidden />
            {t("seasonal.banner.configure")}
          </Link>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleDismiss}
          aria-label={t("seasonal.banner.dismiss")}
          title={t("seasonal.banner.dismiss")}
          className="size-7"
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
