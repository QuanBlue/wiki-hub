import type { LucideIcon } from "lucide-react";

import type { Locale } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";

const NUMBER_FORMAT_LOCALE: Record<string, string> = { en: "en-US", vi: "vi-VN" };

export interface SummaryMetricItem {
  icon: LucideIcon;
  label: string;
  value: number;
  /** Tints the icon chip - `success`/`warning` echo the same meaning the
   * Status badges elsewhere already use (Active/Archived, Active/Disabled),
   * `primary` marks the one headline number worth noticing first, and
   * `neutral` (the default) is for the rest. */
  tone?: "primary" | "success" | "warning" | "neutral";
}

const TONE_CLASSES: Record<NonNullable<SummaryMetricItem["tone"]>, string> = {
  primary: "bg-primary-subtle text-primary",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  neutral: "bg-surface-sunken text-muted-foreground",
};

const GRID_COLS_BY_COUNT: Record<number, string> = {
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-3 lg:grid-cols-4",
  5: "sm:grid-cols-3 lg:grid-cols-5",
};

/**
 * The compact stat-tile row every Administration directory page (Users,
 * Groups, Spaces) opens with - one shared component so the three stay
 * visually identical instead of each hand-rolling its own grid and drifting
 * apart, and so a future tweak (spacing, a new tone) only needs one place.
 * A tinted icon chip per tile (rather than a plain muted-gray icon) reads a
 * touch more prominent without turning this into a dashboard - values stay
 * the same size relationship as before, just tighter vertical padding.
 */
export function SummaryMetrics({
  label,
  items,
  locale = "en",
}: {
  label: string;
  items: SummaryMetricItem[];
  /** Passed down rather than read via `useTranslation()` so this stays a
   * plain presentational component usable from a Server Component page
   * (which cannot call a client hook) as well as a client one. */
  locale?: Locale;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "border-border bg-surface grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border",
        GRID_COLS_BY_COUNT[items.length] ?? "sm:grid-cols-3",
      )}
    >
      {items.map(({ icon: Icon, label: itemLabel, value, tone = "neutral" }) => (
        <div
          key={itemLabel}
          className="border-border/70 flex min-w-0 items-center gap-2.5 border-b px-3.5 py-2.5 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0"
        >
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md",
              TONE_CLASSES[tone],
            )}
          >
            <Icon className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-muted-foreground truncate text-[11px] font-medium">
              {itemLabel}
            </p>
            <p className="text-foreground text-base leading-tight font-semibold tracking-tight">
              {new Intl.NumberFormat(NUMBER_FORMAT_LOCALE[locale] ?? "en-US").format(value)}
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}
