import type { LucideIcon } from "lucide-react";

import type { Locale } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";

export interface StatCardItem {
  icon: LucideIcon;
  label: string;
  value: number;
  /** Shown instead of the formatted number, for a value that is not a count (a duration). */
  display?: string;
  /** A derived figure under the label, such as a daily average or a share. */
  hint: string;
  tone?: "primary" | "success" | "warning" | "info" | "neutral";
}

const INTL_LOCALE: Record<string, string> = { en: "en-US", vi: "vi-VN" };

const TONE_CLASSES: Record<NonNullable<StatCardItem["tone"]>, string> = {
  primary: "bg-primary-subtle text-primary",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  info: "bg-info-bg text-info",
  neutral: "bg-surface-sunken text-muted-foreground",
};

/** A row of headline figures: one card each, a tinted icon, a large number and its label. */
export function StatCards({
  label,
  items,
  locale = "en",
}: {
  label: string;
  items: StatCardItem[];
  locale?: Locale;
}) {
  const number = new Intl.NumberFormat(INTL_LOCALE[locale] ?? "en-US");
  return (
    <section
      aria-label={label}
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:grid-cols-3",
        items.length >= 8 ? "lg:grid-cols-4 2xl:grid-cols-8" : "lg:grid-cols-5",
      )}
    >
      {items.map(
        ({
          icon: Icon,
          label: itemLabel,
          value,
          display,
          hint,
          tone = "neutral",
        }) => (
          <div
            key={itemLabel}
            className="border-border bg-surface flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 shadow-sm"
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md",
                TONE_CLASSES[tone],
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-foreground text-lg leading-6 font-semibold tracking-tight tabular-nums">
                {display ?? number.format(value)}
              </p>
              <p className="text-muted-foreground truncate text-xs font-medium">
                {itemLabel}
              </p>
              <p className="text-muted-foreground/80 mt-0.5 truncate text-[11px]">
                {hint}
              </p>
            </div>
          </div>
        ),
      )}
    </section>
  );
}
